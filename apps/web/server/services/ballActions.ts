import { prisma, type Prisma } from '@trakon/db';
import { deriveBallHolder, type BallEventType, type BallHolderResult, type PlanState } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import { toPlanDTO, type PlanDTO } from './plans.js';

export type TossResult = {
  plan: PlanDTO;
  autoTossed: PlanDTO | null;
};

export type CompleteResult = {
  plan: PlanDTO;
  autoTossed: PlanDTO | null;
};

const PLAN_INCLUDE = {
  executor: true,
  approver: true,
  progressManager: true,
  fromMember: true,
  toMember: true,
  ballEvents: {
    include: { actorMember: true },
    orderBy: { occurredAt: 'desc' as const },
  },
} as const;

type PlanWithIncludes = Prisma.PlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

type AuditAction =
  | 'toss'
  | 'complete'
  | 'untoss'
  | 'undo_complete'
  | 'request_review'
  | 'undo_request_review'
  | 'approve'
  | 'undo_approve'
  | 'send_back';

async function loadPlanWithIncludes(
  tx: Prisma.TransactionClient,
  planId: string,
  itemId: string,
): Promise<PlanWithIncludes> {
  const row = await tx.plan.findFirst({
    where: { id: planId, itemId, deletedAt: null },
    include: PLAN_INCLUDE,
  });
  if (!row) throw new ApiException('NOT_FOUND', 404, 'Plan not found.');
  return row;
}

/** plan + 最新イベントから Ball Holder / state を導出する (deriveBallHolder に委譲)。 */
function deriveFor(plan: PlanWithIncludes): BallHolderResult {
  const latest = plan.ballEvents[0]; // occurredAt DESC
  return deriveBallHolder(
    {
      executorMemberId: plan.executorMemberId,
      approverMemberId: plan.approverMemberId,
      progressManagerMemberId: plan.progressManagerMemberId,
      toMemberId: plan.toMemberId,
      status: plan.status as 'active' | 'completed' | 'canceled',
    },
    latest
      ? {
          eventType: latest.eventType as BallEventType,
          source: latest.source as 'human' | 'auto_chain',
          occurredAt: latest.occurredAt,
        }
      : null,
  );
}

function currentBallState(plan: PlanWithIncludes): PlanState {
  return deriveFor(plan).state;
}

function ballHolderMemberId(plan: PlanWithIncludes): string | null {
  return deriveFor(plan).memberId;
}

async function recordAudit(input: {
  tx: Prisma.TransactionClient;
  actorUserId: string;
  action: AuditAction;
  planId: string;
}): Promise<void> {
  await input.tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: 'plan',
      resourceId: input.planId,
      result: 'success',
    },
  });
}

function assertActive(plan: PlanWithIncludes): void {
  if (plan.status !== 'active') {
    throw new ApiException('PLAN_NOT_ACTIVE', 422, 'Plan is not active.');
  }
}

/** 現在の Ball Holder または director でなければ 403。 */
function assertHolderOrDirector(plan: PlanWithIncludes, currentMemberId: string, isDirector: boolean): void {
  if (!isDirector && ballHolderMemberId(plan) !== currentMemberId) {
    throw new ApiException('FORBIDDEN', 403, 'Only the ball holder or director can perform this action.');
  }
}

async function createEvent(input: {
  tx: Prisma.TransactionClient;
  planId: string;
  eventType: string;
  currentMemberId: string;
  currentUserId: string;
  note?: string | null;
}): Promise<void> {
  await input.tx.ballEvent.create({
    data: {
      planId: input.planId,
      eventType: input.eventType,
      source: 'human',
      actorMemberId: input.currentMemberId,
      actorUserId: input.currentUserId,
      note: input.note ?? null,
    },
  });
}

// -----------------------------------------------------------------------------
// 確認依頼 (実施中/差し戻し → 確認待ち)
// -----------------------------------------------------------------------------
export async function requestReviewPlan(input: {
  itemId: string;
  planId: string;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<{ plan: PlanDTO }> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);
    assertActive(plan);
    const state = currentBallState(plan);
    if (state !== 'in_progress' && state !== 'sent_back') {
      throw new ApiException('INVALID_STATE', 409, '確認依頼は実施中の予定にのみ行えます。');
    }
    if (!plan.executorMemberId) {
      throw new ApiException('INCOMPLETE_PLAN', 422, '実施者を設定してください。');
    }
    if (!plan.approverMemberId) {
      throw new ApiException('NO_APPROVER', 422, '承認者が設定されていません。承認者なしの予定は直接承認してください。');
    }
    assertHolderOrDirector(plan, input.currentMemberId, input.isDirector);

    await createEvent({ tx, planId: plan.id, eventType: 'review_requested', currentMemberId: input.currentMemberId, currentUserId: input.currentUserId });
    await recordAudit({ tx, actorUserId: input.currentUserId, action: 'request_review', planId: plan.id });
    return loadPlanWithIncludes(tx, plan.id, input.itemId);
  });
  return { plan: toPlanDTO(result) };
}

// -----------------------------------------------------------------------------
// 確認依頼の取り消し (確認待ち → 実施中)
// -----------------------------------------------------------------------------
export async function undoRequestReviewPlan(input: {
  itemId: string;
  planId: string;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<{ plan: PlanDTO }> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);
    assertActive(plan);
    if (currentBallState(plan) !== 'review_pending') {
      throw new ApiException('INVALID_STATE', 409, '確認待ちの予定のみ確認依頼を取り消せます。');
    }
    // 実施者・承認者・director が取り消せる (誤操作の救済)。
    const involved = [plan.executorMemberId, plan.approverMemberId];
    if (!input.isDirector && !involved.includes(input.currentMemberId)) {
      throw new ApiException('FORBIDDEN', 403, 'Only the executor, approver, or director can undo a review request.');
    }
    await createEvent({ tx, planId: plan.id, eventType: 'review_request_undone', currentMemberId: input.currentMemberId, currentUserId: input.currentUserId });
    await recordAudit({ tx, actorUserId: input.currentUserId, action: 'undo_request_review', planId: plan.id });
    return loadPlanWithIncludes(tx, plan.id, input.itemId);
  });
  return { plan: toPlanDTO(result) };
}

// -----------------------------------------------------------------------------
// 承認 (確認待ち → 承認済み。承認者なしなら 実施中 → 承認済み)
//   後続が無い予定は「承認=完了扱い」で status=completed にする (#131 §6)。
// -----------------------------------------------------------------------------
export async function approvePlan(input: {
  itemId: string;
  planId: string;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<CompleteResult> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);
    assertActive(plan);
    const state = currentBallState(plan);
    if (plan.approverMemberId) {
      if (state !== 'review_pending') {
        throw new ApiException('INVALID_STATE', 409, '確認待ちの予定のみ承認できます。');
      }
    } else {
      if (state !== 'in_progress' && state !== 'sent_back') {
        throw new ApiException('INVALID_STATE', 409, '実施中の予定のみ承認できます。');
      }
      if (!plan.executorMemberId) {
        throw new ApiException('INCOMPLETE_PLAN', 422, '実施者を設定してください。');
      }
    }
    assertHolderOrDirector(plan, input.currentMemberId, input.isDirector);

    await createEvent({ tx, planId: plan.id, eventType: 'approved', currentMemberId: input.currentMemberId, currentUserId: input.currentUserId });
    // 後続が無い予定は承認で完了 (TOSS 先が無い)。
    if (!plan.successorPlanId) {
      await tx.plan.update({
        where: { id: plan.id },
        data: { status: 'completed', completedAt: new Date() },
      });
    }
    await recordAudit({ tx, actorUserId: input.currentUserId, action: 'approve', planId: plan.id });
    return loadPlanWithIncludes(tx, plan.id, input.itemId);
  });
  return { plan: toPlanDTO(result), autoTossed: null };
}

// -----------------------------------------------------------------------------
// 承認の取り消し (承認済み → 確認待ち / 実施中)。完了扱いだった場合は active に戻す。
// -----------------------------------------------------------------------------
export async function undoApprovePlan(input: {
  itemId: string;
  planId: string;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<{ plan: PlanDTO }> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);
    // 承認済み (active) か、承認=完了で completed になった予定が対象。
    const state = currentBallState(plan);
    const wasApprovedComplete = plan.status === 'completed' && !plan.successorPlanId;
    if (state !== 'approved' && !wasApprovedComplete) {
      throw new ApiException('INVALID_STATE', 409, '承認済みの予定のみ承認を取り消せます。');
    }
    // 承認者 or 進行責任者 or director。
    const involved = [plan.approverMemberId, plan.progressManagerMemberId];
    if (!input.isDirector && !involved.includes(input.currentMemberId)) {
      throw new ApiException('FORBIDDEN', 403, 'Only the approver, progress manager, or director can undo an approval.');
    }
    await createEvent({ tx, planId: plan.id, eventType: 'approval_undone', currentMemberId: input.currentMemberId, currentUserId: input.currentUserId });
    if (plan.status === 'completed') {
      await tx.plan.update({ where: { id: plan.id }, data: { status: 'active', completedAt: null } });
    }
    await recordAudit({ tx, actorUserId: input.currentUserId, action: 'undo_approve', planId: plan.id });
    return loadPlanWithIncludes(tx, plan.id, input.itemId);
  });
  return { plan: toPlanDTO(result) };
}

// -----------------------------------------------------------------------------
// 差し戻し (確認待ち → 差し戻し。承認者が実施側へ戻す。同一カード継続 §13)
// -----------------------------------------------------------------------------
export async function sendBackPlan(input: {
  itemId: string;
  planId: string;
  note?: string | null;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<{ plan: PlanDTO }> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);
    assertActive(plan);
    if (currentBallState(plan) !== 'review_pending') {
      throw new ApiException('INVALID_STATE', 409, '確認待ちの予定のみ差し戻せます。');
    }
    // 承認者 (= 現ホルダー) または director。
    assertHolderOrDirector(plan, input.currentMemberId, input.isDirector);
    await createEvent({
      tx,
      planId: plan.id,
      eventType: 'sent_back',
      currentMemberId: input.currentMemberId,
      currentUserId: input.currentUserId,
      note: input.note ?? null,
    });
    await recordAudit({ tx, actorUserId: input.currentUserId, action: 'send_back', planId: plan.id });
    return loadPlanWithIncludes(tx, plan.id, input.itemId);
  });
  return { plan: toPlanDTO(result) };
}

// -----------------------------------------------------------------------------
// 前工程へ差し戻し (#131 §13)。後続予定の実施中/差し戻し中(=確認依頼前)から、先行予定
// (自分を successor に指す予定)を再開する。新しい予定カードは作らない。
//   - 先行予定: sent_back を追記し status=active・完了/TOSS履歴を解除 → 実施者にボール。
//   - 後続予定(この予定): 状態はそのまま(実施者にボールがある)。ボールは先行へ移る。
//   - 認可: 現ボール保持者 or director (会員のみ。共有リンクからは不可)。
// -----------------------------------------------------------------------------
export async function sendBackToPredecessorPlan(input: {
  itemId: string;
  planId: string;
  note?: string | null;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<{ plan: PlanDTO; predecessor: PlanDTO }> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);
    assertActive(plan);
    const state = currentBallState(plan);
    if (state !== 'in_progress' && state !== 'sent_back') {
      throw new ApiException('INVALID_STATE', 409, '実施中または差し戻し中の予定のみ前工程へ差し戻せます。');
    }
    // 認可: 後続予定の現ボール保持者 (実施者/承認者) または director。
    assertHolderOrDirector(plan, input.currentMemberId, input.isDirector);

    // 先行予定 = この予定を successor に指す予定 (successorPlanId は UNIQUE のため最大1件)。
    const predecessor = await tx.plan.findFirst({
      where: { successorPlanId: plan.id, deletedAt: null },
      select: { id: true },
    });
    if (!predecessor) {
      throw new ApiException('NO_PREDECESSOR', 422, '前工程(先行予定)がありません。');
    }

    // 先行予定を再開: sent_back を追記し、完了/TOSS履歴を解除 → 実施者にボールが戻る。
    await createEvent({
      tx,
      planId: predecessor.id,
      eventType: 'sent_back',
      currentMemberId: input.currentMemberId,
      currentUserId: input.currentUserId,
      note: input.note ?? null,
    });
    await tx.plan.update({
      where: { id: predecessor.id },
      data: { status: 'active', completedAt: null, fromMemberId: null, toMemberId: null },
    });

    // 監査は「先行予定が差し戻された」として先行予定に記録する。
    await recordAudit({ tx, actorUserId: input.currentUserId, action: 'send_back', planId: predecessor.id });

    return {
      plan: await loadPlanWithIncludes(tx, plan.id, input.itemId),
      predecessor: await loadPlanWithIncludes(tx, predecessor.id, input.itemId),
    };
  });
  return { plan: toPlanDTO(result.plan), predecessor: toPlanDTO(result.predecessor) };
}

// -----------------------------------------------------------------------------
// TOSS (承認済み → TOSS済み)。進行責任者が後続予定へボールを渡す。
//   FROM=進行責任者 / TO=後続予定の実施者 を履歴として書き込む (#131 §14)。
//   先行予定は status=completed になる (承認=完了扱い、後続あり版)。
// -----------------------------------------------------------------------------
export async function tossPlan(input: {
  itemId: string;
  projectId: string;
  planId: string;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<TossResult> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);
    assertActive(plan);
    if (currentBallState(plan) !== 'approved') {
      throw new ApiException('NOT_APPROVED', 409, '承認済みの予定のみ TOSS できます。');
    }
    if (!plan.successorPlanId) {
      throw new ApiException('NO_SUCCESSOR', 422, '後続予定が無いためTOSSできません。');
    }
    if (!plan.progressManagerMemberId) {
      throw new ApiException('INCOMPLETE_PLAN', 422, '進行責任者を設定してください。');
    }
    // 認可: 進行責任者 (= 現ホルダー) または director。
    assertHolderOrDirector(plan, input.currentMemberId, input.isDirector);

    const successor = await tx.plan.findFirst({
      where: { id: plan.successorPlanId, deletedAt: null },
      select: { id: true, executorMemberId: true },
    });
    if (!successor) {
      throw new ApiException('NO_SUCCESSOR', 422, '後続予定が見つかりません。');
    }
    if (!successor.executorMemberId) {
      throw new ApiException('SUCCESSOR_NO_EXECUTOR', 422, '後続予定の実施者を設定してください。');
    }

    // FROM/TO 履歴スナップショット + 先行完了。
    await tx.plan.update({
      where: { id: plan.id },
      data: {
        fromMemberId: plan.progressManagerMemberId,
        toMemberId: successor.executorMemberId,
        status: 'completed',
        completedAt: new Date(),
      },
    });
    await createEvent({ tx, planId: plan.id, eventType: 'tossed', currentMemberId: input.currentMemberId, currentUserId: input.currentUserId });
    await recordAudit({ tx, actorUserId: input.currentUserId, action: 'toss', planId: plan.id });
    return loadPlanWithIncludes(tx, plan.id, input.itemId);
  });
  return { plan: toPlanDTO(result), autoTossed: null };
}

// -----------------------------------------------------------------------------
// TOSS の取り消し (TOSS済み → 承認済み)。誤TOSSの救済 (#50)。
//   append-only のため approved を再追記して承認済みへ戻し、FROM/TO 履歴を消す。
// -----------------------------------------------------------------------------
export async function undoTossPlan(input: {
  itemId: string;
  projectId: string;
  planId: string;
  currentUserId: string;
  currentMemberId: string;
}): Promise<{ plan: PlanDTO }> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);
    if (currentBallState(plan) !== 'tossed') {
      throw new ApiException('NOT_TOSSED', 409, 'Ball is not in a tossed state.');
    }
    // 後続が既に承認/完了へ進んでいる場合は取り消せない。
    if (plan.successorPlanId) {
      const successor = await tx.plan.findFirst({
        where: { id: plan.successorPlanId, deletedAt: null },
        select: { status: true },
      });
      if (successor?.status === 'completed') {
        throw new ApiException('SUCCESSOR_ALREADY_COMPLETED', 409, '後続予定が完了済みのため TOSS を取り消せません。');
      }
    }
    // 誤TOSSの救済としてプロジェクトメンバーなら誰でも取り消し可能 (#50)。
    await tx.plan.update({
      where: { id: plan.id },
      data: { fromMemberId: null, toMemberId: null, status: 'active', completedAt: null },
    });
    await createEvent({ tx, planId: plan.id, eventType: 'approved', currentMemberId: input.currentMemberId, currentUserId: input.currentUserId });
    await recordAudit({ tx, actorUserId: input.currentUserId, action: 'untoss', planId: plan.id });
    return loadPlanWithIncludes(tx, plan.id, input.itemId);
  });
  return { plan: toPlanDTO(result) };
}

// -----------------------------------------------------------------------------
// 後方互換エイリアス。旧 /complete・/complete-undo ルートおよび共有リンクから使う。
// 新モデルでは「完了」= 承認 (approve) に対応する。
// -----------------------------------------------------------------------------
export async function completePlan(input: {
  itemId: string;
  projectId: string;
  planId: string;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<CompleteResult> {
  return approvePlan(input);
}

export async function undoCompletePlan(input: {
  itemId: string;
  projectId: string;
  planId: string;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<{ plan: PlanDTO }> {
  return undoApprovePlan(input);
}
