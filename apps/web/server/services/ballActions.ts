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

function ballAlreadyTossed(plan: PlanWithIncludes): boolean {
  return plan.ballEvents.some((e) => e.eventType === 'tossed');
}

function ballHolderMemberId(plan: PlanWithIncludes): string | null {
  if (plan.ballEvents.length === 0) return plan.fromMemberId;
  // ball_events は occurredAt DESC で取得しているので [0] が最新
  const latest = plan.ballEvents[0];
  if (latest?.eventType === 'tossed') return plan.toMemberId;
  return plan.toMemberId; // completed も to
}

async function recordAudit(input: {
  tx: Prisma.TransactionClient;
  actorUserId: string;
  action: 'toss' | 'complete' | 'auto_toss';
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
    if (ballAlreadyTossed(plan)) {
      throw new ApiException('ALREADY_TOSSED', 409, 'Ball has already been tossed.');
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
      if (successor && successor.status === 'active' && !ballAlreadyTossed(successor)) {
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
