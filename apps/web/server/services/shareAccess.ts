import { prisma, type Prisma } from '@trakon/db';
import { deriveBallHolder, pickLatestBallEvent } from '@trakon/shared';

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

/**
 * 非会員 URL 経由で TOSS を発火。
 * Phase 0: actor=null (system_share)。Ball Holder 認可は適用せず scope のみで判定。
 * 設計書 §5.6: クライアントロール相当の操作を許可。
 */
export async function shareToss(input: {
  rawToken: string;
  planId: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ plan: PlanDTO }> {
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
    if (plan.ballEvents.some((e) => e.eventType === 'tossed')) {
      throw new ApiException('ALREADY_TOSSED', 409, 'Ball has already been tossed.');
    }

    // 非会員アクセスは system actor 扱いで auto_chain と同じスキーマで記録
    // (ck_be_actor_consistency: source='auto_chain' なら actor 両方 NULL)
    await tx.ballEvent.create({
      data: {
        planId: plan.id,
        eventType: 'tossed',
        source: 'auto_chain',
        actorMemberId: null,
        actorUserId: null,
        note: `via share_link:${share.id}`,
      },
    });
    await tx.auditLog.create({
      data: {
        shareLinkId: share.id,
        action: 'share_toss',
        resourceType: 'plan',
        resourceId: plan.id,
        result: 'success',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    return await loadPlanWithIncludes(tx, plan.id, itemId);
  });

  return { plan: toPlanDTO(result, []) };
}

/**
 * 非会員 URL 経由で完了を発火。successor 自動連鎖も同一トランザクションで処理。
 */
export async function shareComplete(input: {
  rawToken: string;
  planId: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ plan: PlanDTO; autoTossed: PlanDTO | null }> {
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

    await tx.ballEvent.create({
      data: {
        planId: plan.id,
        eventType: 'completed',
        source: 'auto_chain',
        actorMemberId: null,
        actorUserId: null,
        note: `via share_link:${share.id}`,
      },
    });
    await tx.plan.update({
      where: { id: plan.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        shareLinkId: share.id,
        action: 'share_complete',
        resourceType: 'plan',
        resourceId: plan.id,
        result: 'success',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    let autoTossed: Awaited<ReturnType<typeof loadPlanWithIncludes>> | null = null;
    if (plan.successorPlanId) {
      const successor = await tx.plan.findFirst({
        where: { id: plan.successorPlanId, itemId, deletedAt: null },
        include: PLAN_INCLUDE,
      });
      const succLatest = successor
        ? pickLatestBallEvent(
            successor.ballEvents.map((e) => ({
              eventType: e.eventType as 'tossed' | 'completed',
              source: e.source as 'human' | 'auto_chain',
              occurredAt: e.occurredAt,
            })),
          )
        : null;
      const succHolder = successor
        ? deriveBallHolder(
            { fromMemberId: successor.fromMemberId, toMemberId: successor.toMemberId, status: successor.status as 'active' | 'completed' | 'canceled' },
            succLatest,
          )
        : null;
      if (successor && successor.status === 'active' && succHolder?.state === 'ready') {
        await tx.ballEvent.create({
          data: {
            planId: successor.id,
            eventType: 'tossed',
            source: 'auto_chain',
            actorMemberId: null,
            actorUserId: null,
          },
        });
        autoTossed = await loadPlanWithIncludes(tx, successor.id, itemId);
      }
    }

    return {
      completed: await loadPlanWithIncludes(tx, plan.id, itemId),
      autoTossed,
    };
  });

  return {
    plan: toPlanDTO(result.completed, []),
    autoTossed: result.autoTossed ? toPlanDTO(result.autoTossed, []) : null,
  };
}
