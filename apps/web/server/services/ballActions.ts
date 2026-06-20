import { prisma, type Prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';
import type { TossBody } from '../schemas/plans.js';
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
  fromMember: true,
  toMember: true,
  ballEvents: {
    include: { actorMember: true },
    orderBy: { occurredAt: 'desc' as const },
  },
} as const;

type PlanWithIncludes = Prisma.PlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

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

/**
 * 最新イベント 1 件で現在の ball state を判定する。
 * toss_undone (差し戻し) は直前の tossed を打ち消し ready に、
 * completion_undone (完了の差し戻し) は直前の completed を打ち消し tossed に戻す。
 * ball_events は occurredAt DESC で取得しているので [0] が最新。
 */
function currentBallState(plan: PlanWithIncludes): 'ready' | 'tossed' | 'completed' {
  const latest = plan.ballEvents[0];
  if (!latest || latest.eventType === 'toss_undone') return 'ready';
  if (latest.eventType === 'tossed' || latest.eventType === 'completion_undone') return 'tossed';
  return 'completed';
}

function ballHolderMemberId(plan: PlanWithIncludes): string | null {
  return currentBallState(plan) === 'ready' ? plan.fromMemberId : plan.toMemberId;
}

async function recordAudit(input: {
  tx: Prisma.TransactionClient;
  actorUserId: string;
  action: 'toss' | 'complete' | 'auto_toss' | 'untoss' | 'undo_complete';
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

// -----------------------------------------------------------------------------
// TOSS
// -----------------------------------------------------------------------------
export async function tossPlan(input: {
  itemId: string;
  projectId: string;
  planId: string;
  body: TossBody;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<TossResult> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);

    if (plan.status !== 'active') {
      throw new ApiException('PLAN_NOT_ACTIVE', 422, 'Plan is not active.');
    }
    if (currentBallState(plan) !== 'ready') {
      throw new ApiException('ALREADY_TOSSED', 409, 'Ball has already been tossed.');
    }
    // 実施者(FROM)/確認者(TO) 未設定の予定は TOSS できない (#55)
    if (!plan.fromMemberId || !plan.toMemberId) {
      throw new ApiException(
        'INCOMPLETE_PLAN',
        422,
        '実施者(FROM)と確認者(TO)を設定してください。',
      );
    }

    // 認可: 現在の Ball Holder (= fromMember) または ディレクター
    const holder = ballHolderMemberId(plan);
    if (!input.isDirector && holder !== input.currentMemberId) {
      throw new ApiException('FORBIDDEN', 403, 'Only the ball holder or director can toss.');
    }

    // 任意で TOSS 先を変更
    if (input.body.toMemberId && input.body.toMemberId !== plan.toMemberId) {
      const validMember = await tx.projectMember.findFirst({
        where: {
          id: input.body.toMemberId,
          projectId: input.projectId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!validMember) {
        throw new ApiException(
          'INVALID_TO_MEMBER',
          422,
          'toMemberId does not belong to this project.',
        );
      }
      if (validMember.id === plan.fromMemberId) {
        throw new ApiException(
          'INVALID_TO_MEMBER',
          422,
          'TOSS target must differ from the current ball holder.',
        );
      }
      await tx.plan.update({
        where: { id: plan.id },
        data: { toMemberId: validMember.id },
      });
    }

    await tx.ballEvent.create({
      data: {
        planId: plan.id,
        eventType: 'tossed',
        source: 'human',
        actorMemberId: input.currentMemberId,
        actorUserId: input.currentUserId,
      },
    });

    await recordAudit({
      tx,
      actorUserId: input.currentUserId,
      action: 'toss',
      planId: plan.id,
    });

    const refreshed = await loadPlanWithIncludes(tx, plan.id, input.itemId);
    return refreshed;
  });

  return { plan: toPlanDTO(result, []), autoTossed: null };
}

// -----------------------------------------------------------------------------
// Complete (with auto-chain TOSS)
// -----------------------------------------------------------------------------
export async function completePlan(input: {
  itemId: string;
  projectId: string;
  planId: string;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<CompleteResult> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);

    if (plan.status !== 'active') {
      throw new ApiException('PLAN_NOT_ACTIVE', 422, 'Plan is not active.');
    }
    // 認可: 現在の Ball Holder か ディレクター
    const holder = ballHolderMemberId(plan);
    if (!input.isDirector && holder !== input.currentMemberId) {
      throw new ApiException(
        'FORBIDDEN',
        403,
        'Only the ball holder or director can complete.',
      );
    }

    await tx.ballEvent.create({
      data: {
        planId: plan.id,
        eventType: 'completed',
        source: 'human',
        actorMemberId: input.currentMemberId,
        actorUserId: input.currentUserId,
      },
    });
    await tx.plan.update({
      where: { id: plan.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    await recordAudit({
      tx,
      actorUserId: input.currentUserId,
      action: 'complete',
      planId: plan.id,
    });

    // 自動連鎖 (Phase 0 は同一 item 内、1 段のみ)
    let autoTossed: PlanWithIncludes | null = null;
    if (plan.successorPlanId) {
      const successor = await tx.plan.findFirst({
        where: { id: plan.successorPlanId, itemId: input.itemId, deletedAt: null },
        include: PLAN_INCLUDE,
      });
      if (successor && successor.status === 'active' && currentBallState(successor) === 'ready') {
        await tx.ballEvent.create({
          data: {
            planId: successor.id,
            eventType: 'tossed',
            source: 'auto_chain',
            actorMemberId: null,
            actorUserId: null,
          },
        });
        await recordAudit({
          tx,
          actorUserId: input.currentUserId,
          action: 'auto_toss',
          planId: successor.id,
        });
        autoTossed = await loadPlanWithIncludes(tx, successor.id, input.itemId);
      }
    }

    const completed = await loadPlanWithIncludes(tx, plan.id, input.itemId);
    return { completed, autoTossed };
  });

  return {
    plan: toPlanDTO(result.completed, []),
    autoTossed: result.autoTossed ? toPlanDTO(result.autoTossed, []) : null,
  };
}

// -----------------------------------------------------------------------------
// Undo TOSS (差し戻し)
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

    if (plan.status !== 'active') {
      throw new ApiException('PLAN_NOT_ACTIVE', 422, 'Plan is not active.');
    }
    if (currentBallState(plan) !== 'tossed') {
      throw new ApiException('NOT_TOSSED', 409, 'Ball is not in a tossed state.');
    }

    // 誤TOSSの救済として、プロジェクトメンバーなら誰でも差し戻し可能 (#50)。
    // ボール保持者/ディレクター縛りは廃止 (ルートの requireProjectMember で担保)。

    // append-only のため、行削除ではなく toss_undone を追記して ready に戻す
    await tx.ballEvent.create({
      data: {
        planId: plan.id,
        eventType: 'toss_undone',
        source: 'human',
        actorMemberId: input.currentMemberId,
        actorUserId: input.currentUserId,
      },
    });
    await recordAudit({
      tx,
      actorUserId: input.currentUserId,
      action: 'untoss',
      planId: plan.id,
    });

    return loadPlanWithIncludes(tx, plan.id, input.itemId);
  });

  return { plan: toPlanDTO(result, []) };
}

// -----------------------------------------------------------------------------
// Undo Complete (完了の差し戻し) — #89
// -----------------------------------------------------------------------------
export async function undoCompletePlan(input: {
  itemId: string;
  projectId: string;
  planId: string;
  currentUserId: string;
  currentMemberId: string;
  isDirector: boolean;
}): Promise<{ plan: PlanDTO }> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await loadPlanWithIncludes(tx, input.planId, input.itemId);

    if (plan.status !== 'completed') {
      throw new ApiException('PLAN_NOT_COMPLETED', 422, 'Plan is not completed.');
    }

    // 認可: 完了直前のボール保持者 (= toMember) または ディレクター。
    // 完了済みプランの holder は toMember (完了者) なので completePlan と対称。
    const holder = ballHolderMemberId(plan);
    if (!input.isDirector && holder !== input.currentMemberId) {
      throw new ApiException(
        'FORBIDDEN',
        403,
        'Only the ball holder or director can undo a completion.',
      );
    }

    // 完了時に後続を自動 TOSS していた場合、その auto_chain TOSS も巻き戻す。
    // - 後続の最新イベントが auto_chain の tossed → この完了が誘発したもの。toss_undone で ready に戻す。
    // - 後続が既に完了している → 差し戻すと不整合になるためブロックする。
    // - それ以外 (自動連鎖していない / 既に人手で操作済み) → 後続には触れない。
    if (plan.successorPlanId) {
      const successor = await tx.plan.findFirst({
        where: { id: plan.successorPlanId, itemId: input.itemId, deletedAt: null },
        include: PLAN_INCLUDE,
      });
      if (successor) {
        const succLatest = successor.ballEvents[0];
        const wasAutoChainedByThis =
          !!succLatest && succLatest.eventType === 'tossed' && succLatest.source === 'auto_chain';
        if (wasAutoChainedByThis) {
          await tx.ballEvent.create({
            data: {
              planId: successor.id,
              eventType: 'toss_undone',
              source: 'human',
              actorMemberId: input.currentMemberId,
              actorUserId: input.currentUserId,
            },
          });
          await recordAudit({
            tx,
            actorUserId: input.currentUserId,
            action: 'untoss',
            planId: successor.id,
          });
        } else if (successor.status === 'completed') {
          throw new ApiException(
            'SUCCESSOR_ALREADY_COMPLETED',
            409,
            '後続予定が完了済みのため、この予定の完了を取り消せません。',
          );
        }
      }
    }

    // append-only のため、completed 行は削除せず completion_undone を追記して tossed に戻す
    await tx.ballEvent.create({
      data: {
        planId: plan.id,
        eventType: 'completion_undone',
        source: 'human',
        actorMemberId: input.currentMemberId,
        actorUserId: input.currentUserId,
      },
    });
    await tx.plan.update({
      where: { id: plan.id },
      data: { status: 'active', completedAt: null },
    });
    await recordAudit({
      tx,
      actorUserId: input.currentUserId,
      action: 'undo_complete',
      planId: plan.id,
    });

    return loadPlanWithIncludes(tx, plan.id, input.itemId);
  });

  return { plan: toPlanDTO(result, []) };
}
