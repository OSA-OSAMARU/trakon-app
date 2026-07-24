import { prisma, type Prisma } from '@trakon/db';
import { deriveBallHolder, type BallEventType, type PlanState } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import { toPlanDTO, type PlanDTO } from './plans.js';
import { findActiveShareLinkByRawToken, touchShareLinkAccess } from './shareLinks.js';

export type ShareViewDTO = {
  share: {
    id: string;
    scopeType: 'project' | 'item' | 'plan';
    scopeTargetId: string | null;
    /** null = 無期限 */
    expiresAt: string | null;
  };
  project: { id: string; name: string; startDate: string; endDate: string };
  items: Array<{ id: string; name: string }>;
  plans: PlanDTO[];
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

/**
 * トークンを検証してスコープに応じた閲覧情報を返す。
 * 全アクセスを audit_logs に記録する。
 */
export async function viewShare(input: {
  rawToken: string;
  ip?: string;
  userAgent?: string;
}): Promise<ShareViewDTO> {
  const share = await findActiveShareLinkByRawToken(input.rawToken);

  const project = await prisma.project.findFirst({
    where: { id: share.projectId, deletedAt: null },
    include: { items: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!project) throw new ApiException('SHARE_NOT_FOUND_OR_EXPIRED', 404, 'Project unavailable.');

  // scope に応じて見せるプランを絞り込む
  const planWhere: Prisma.PlanWhereInput = { deletedAt: null };
  let items = project.items;
  if (share.scopeType === 'project') {
    planWhere.itemId = { in: project.items.map((it) => it.id) };
  } else if (share.scopeType === 'item') {
    const itemId = share.scopeTargetId!;
    items = project.items.filter((it) => it.id === itemId);
    if (items.length === 0)
      throw new ApiException('SHARE_NOT_FOUND_OR_EXPIRED', 404, 'Item unavailable.');
    planWhere.itemId = itemId;
  } else {
    planWhere.id = share.scopeTargetId!;
    // plan の所属 item を items に限定
    const plan = await prisma.plan.findFirst({
      where: { id: share.scopeTargetId!, deletedAt: null },
      select: { itemId: true },
    });
    if (!plan) throw new ApiException('SHARE_NOT_FOUND_OR_EXPIRED', 404, 'Plan unavailable.');
    items = project.items.filter((it) => it.id === plan.itemId);
  }

  const planRows = await prisma.plan.findMany({
    where: planWhere,
    orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
    include: PLAN_INCLUDE,
  });
  const plans = planRows.map((r) => toPlanDTO(r, []));

  // 監査ログ + last_accessed_at
  await Promise.all([
    touchShareLinkAccess(share.id),
    prisma.auditLog.create({
      data: {
        shareLinkId: share.id,
        action: 'share_access',
        resourceType: share.scopeType === 'plan' ? 'plan' : share.scopeType,
        resourceId: share.scopeTargetId ?? share.projectId,
        result: 'success',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    }),
  ]);

  return {
    share: {
      id: share.id,
      scopeType: share.scopeType as 'project' | 'item' | 'plan',
      scopeTargetId: share.scopeTargetId,
      expiresAt: share.expiresAt?.toISOString() ?? null,
    },
    project: {
      id: project.id,
      name: project.name,
      // カレンダー日付軸の生成に使用 (YYYY-MM-DD)
      startDate: project.startDate.toISOString().slice(0, 10),
      endDate: project.endDate.toISOString().slice(0, 10),
    },
    items: items.map((it) => ({ id: it.id, name: it.name })),
    plans,
  };
}

/**
 * share トークンの scope 範囲内に plan が含まれているか検証する。
 */
async function assertPlanInShareScope(input: {
  shareId: string;
  shareScopeType: string;
  shareScopeTargetId: string | null;
  shareProjectId: string;
  planId: string;
}): Promise<{ itemId: string }> {
  const plan = await prisma.plan.findFirst({
    where: { id: input.planId, deletedAt: null },
    include: { item: { select: { projectId: true, id: true } } },
  });
  if (!plan) {
    throw new ApiException('SHARE_NOT_FOUND_OR_EXPIRED', 404, 'Plan unavailable.');
  }
  if (plan.item.projectId !== input.shareProjectId) {
    throw new ApiException('SHARE_NOT_FOUND_OR_EXPIRED', 404, 'Plan out of scope.');
  }
  if (input.shareScopeType === 'item' && plan.item.id !== input.shareScopeTargetId) {
    throw new ApiException('SHARE_NOT_FOUND_OR_EXPIRED', 404, 'Plan out of scope.');
  }
  if (input.shareScopeType === 'plan' && plan.id !== input.shareScopeTargetId) {
    throw new ApiException('SHARE_NOT_FOUND_OR_EXPIRED', 404, 'Plan out of scope.');
  }
  return { itemId: plan.item.id };
}

async function loadPlanWithIncludes(tx: Prisma.TransactionClient, planId: string, itemId: string) {
  const row = await tx.plan.findFirst({
    where: { id: planId, itemId, deletedAt: null },
    include: PLAN_INCLUDE,
  });
  if (!row) throw new ApiException('NOT_FOUND', 404, 'Plan not found.');
  return row;
}

// -----------------------------------------------------------------------------
// 非会員 URL 経由のボール操作 (#131)
//   クライアント(非会員)に「確認依頼 / 承認 / 差し戻し」を許可する。
//   進行責任者の TOSS(次工程へ進める操作)は共有リンクからは行わない。
//   認可: scope 内かつ状態機械が許す限り可 (保持者の種別は問わない)。
//   actor は匿名のため source='auto_chain'(system actor, actor 両方 NULL)で記録し、
//   誰が操作したかは audit_logs.share_link_id で辿る (設計書 §5.6)。
// -----------------------------------------------------------------------------

type ShareStatePlan = {
  status: string;
  executorMemberId: string | null;
  approverMemberId: string | null;
  progressManagerMemberId: string | null;
  toMemberId: string | null;
  ballEvents: { eventType: string; source: string; occurredAt: Date }[];
};

function shareBallState(plan: ShareStatePlan): PlanState {
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
  ).state;
}

type ShareActionInput = {
  rawToken: string;
  planId: string;
  ip?: string;
  userAgent?: string;
};

/**
 * 共有操作の共通スキャフォールド。scope 検証 → tx で plan ロード(active 必須) →
 * apply(状態遷移: イベント作成 + status 更新) → 監査ログ → 再ロードして DTO 化。
 */
async function runShareAction(
  input: ShareActionInput,
  auditAction: 'share_request_review' | 'share_approve' | 'share_send_back',
  apply: (
    tx: Prisma.TransactionClient,
    plan: Awaited<ReturnType<typeof loadPlanWithIncludes>>,
    shareId: string,
  ) => Promise<void>,
): Promise<{ plan: PlanDTO }> {
  const share = await findActiveShareLinkByRawToken(input.rawToken);
  const { itemId } = await assertPlanInShareScope({
    shareId: share.id,
    shareScopeType: share.scopeType,
    shareScopeTargetId: share.scopeTargetId,
    shareProjectId: share.projectId,
    planId: input.planId,
  });

  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, itemId);
    if (plan.status !== 'active') {
      throw new ApiException('PLAN_NOT_ACTIVE', 422, 'Plan is not active.');
    }
    await apply(tx, plan, share.id);
    await tx.auditLog.create({
      data: {
        shareLinkId: share.id,
        action: auditAction,
        resourceType: 'plan',
        resourceId: plan.id,
        result: 'success',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    return loadPlanWithIncludes(tx, plan.id, itemId);
  });

  return { plan: toPlanDTO(result, []) };
}

function createShareEvent(
  tx: Prisma.TransactionClient,
  planId: string,
  eventType: string,
  shareId: string,
): Promise<unknown> {
  // ck_be_actor_consistency: source='auto_chain' なら actor 両方 NULL
  return tx.ballEvent.create({
    data: {
      planId,
      eventType,
      source: 'auto_chain',
      actorMemberId: null,
      actorUserId: null,
      note: `via share_link:${shareId}`,
    },
  });
}

/** 確認依頼 (実施中/差し戻し → 確認待ち)。承認者・実施者が設定済みで承認者ありのみ。 */
export function shareRequestReview(input: ShareActionInput): Promise<{ plan: PlanDTO }> {
  return runShareAction(input, 'share_request_review', async (tx, plan, shareId) => {
    const state = shareBallState(plan);
    if (state !== 'in_progress' && state !== 'sent_back') {
      throw new ApiException('INVALID_STATE', 409, '確認依頼は実施中の予定にのみ行えます。');
    }
    if (!plan.executorMemberId) {
      throw new ApiException('INCOMPLETE_PLAN', 422, '実施者が設定されていません。');
    }
    if (!plan.approverMemberId) {
      throw new ApiException('NO_APPROVER', 422, '承認者が設定されていません。');
    }
    await createShareEvent(tx, plan.id, 'review_requested', shareId);
  });
}

/** 承認 (確認待ち→承認済み。承認者なしなら実施中→承認済み)。後続なしは承認=完了。 */
export function shareApprove(input: ShareActionInput): Promise<{ plan: PlanDTO }> {
  return runShareAction(input, 'share_approve', async (tx, plan, shareId) => {
    const state = shareBallState(plan);
    if (plan.approverMemberId) {
      if (state !== 'review_pending') {
        throw new ApiException('INVALID_STATE', 409, '確認待ちの予定のみ承認できます。');
      }
    } else {
      if (state !== 'in_progress' && state !== 'sent_back') {
        throw new ApiException('INVALID_STATE', 409, '実施中の予定のみ承認できます。');
      }
      if (!plan.executorMemberId) {
        throw new ApiException('INCOMPLETE_PLAN', 422, '実施者が設定されていません。');
      }
    }
    await createShareEvent(tx, plan.id, 'approved', shareId);
    // 後続が無ければ承認で完了 (TOSS 先が無い)。TOSS 自体はクライアント不可。
    if (!plan.successorPlanId) {
      await tx.plan.update({
        where: { id: plan.id },
        data: { status: 'completed', completedAt: new Date() },
      });
    }
  });
}

/** 差し戻し (確認待ち → 差し戻し。実施側へ戻す)。 */
export function shareSendBack(input: ShareActionInput): Promise<{ plan: PlanDTO }> {
  return runShareAction(input, 'share_send_back', async (tx, plan, shareId) => {
    if (shareBallState(plan) !== 'review_pending') {
      throw new ApiException('INVALID_STATE', 409, '確認待ちの予定のみ差し戻せます。');
    }
    await createShareEvent(tx, plan.id, 'sent_back', shareId);
  });
}
