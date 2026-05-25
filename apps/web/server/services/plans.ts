import { prisma, type Prisma } from '@trakon/db';
import { deriveBallHolder, pickLatestBallEvent } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import type {
  CreatePlanBody,
  ListPlansQuery,
  PlanCategory,
  SetSuccessorBody,
  UpdatePlanBody,
} from '../schemas/plans.js';

export type MemberRef = {
  id: string;
  name: string;
  organizationName: string;
  memberType: 'client' | 'production';
};

export type BallEventDTO = {
  id: string;
  eventType: 'tossed' | 'completed';
  source: 'human' | 'auto_chain';
  actor: MemberRef | null;
  occurredAt: string;
  note: string | null;
};

export type PlanDTO = {
  id: string;
  itemId: string;
  planType: 'toss';
  title: string;
  category: PlanCategory;
  scheduledDate: string;
  dueDate: string | null;
  fromMember: MemberRef | null;
  toMember: MemberRef | null;
  successorPlanId: string | null;
  status: 'active' | 'completed' | 'canceled';
  memo: string | null;
  ballHolder: MemberRef | null;
  ballState: 'ready' | 'tossed' | 'completed';
  latestEvent: BallEventDTO | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlanWithEventsDTO = {
  plan: PlanDTO;
  events: BallEventDTO[];
};

function toDateString(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function toMemberRef(m: {
  id: string;
  name: string;
  organizationName: string;
  memberType: string;
} | null | undefined): MemberRef | null {
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    organizationName: m.organizationName,
    memberType: m.memberType as 'client' | 'production',
  };
}

type PlanRow = Prisma.PlanGetPayload<{
  include: {
    fromMember: true;
    toMember: true;
    ballEvents: {
      include: { actorMember: true };
      orderBy: { occurredAt: 'desc' };
    };
  };
}>;

function toEventDTO(ev: PlanRow['ballEvents'][number]): BallEventDTO {
  return {
    id: ev.id,
    eventType: ev.eventType as 'tossed' | 'completed',
    source: ev.source as 'human' | 'auto_chain',
    actor: toMemberRef(ev.actorMember),
    occurredAt: ev.occurredAt.toISOString(),
    note: ev.note,
  };
}

export function toPlanDTO(row: PlanRow, members: PlanRow['fromMember'][]): PlanDTO {
  const fromMember = toMemberRef(row.fromMember);
  const toMember = toMemberRef(row.toMember);
  const eventsDesc = row.ballEvents; // already DESC
  const latest = pickLatestBallEvent(
    eventsDesc.map((e) => ({
      eventType: e.eventType as 'tossed' | 'completed',
      source: e.source as 'human' | 'auto_chain',
      occurredAt: e.occurredAt,
    })),
  );
  const holder = deriveBallHolder(
    { fromMemberId: row.fromMemberId, toMemberId: row.toMemberId, status: row.status as 'active' | 'completed' | 'canceled' },
    latest,
  );

  let ballHolder: MemberRef | null = null;
  if (holder.memberId === row.fromMemberId) ballHolder = fromMember;
  else if (holder.memberId === row.toMemberId) ballHolder = toMember;
  else if (holder.memberId) {
    const found = members.find((m) => m?.id === holder.memberId);
    ballHolder = toMemberRef(found ?? null);
  }

  const latestEventDTO = eventsDesc[0] ? toEventDTO(eventsDesc[0]) : null;

  return {
    id: row.id,
    itemId: row.itemId,
    planType: row.planType as 'toss',
    title: row.title,
    category: row.category as PlanCategory,
    scheduledDate: toDateString(row.scheduledDate)!,
    dueDate: toDateString(row.dueDate),
    fromMember,
    toMember,
    successorPlanId: row.successorPlanId,
    status: row.status as 'active' | 'completed' | 'canceled',
    memo: row.memo,
    ballHolder,
    ballState: holder.state,
    latestEvent: latestEventDTO,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const PLAN_INCLUDE = {
  fromMember: true,
  toMember: true,
  ballEvents: {
    include: { actorMember: true },
    orderBy: { occurredAt: 'desc' as const },
  },
} as const;

// -----------------------------------------------------------------------------
// list / get
// -----------------------------------------------------------------------------

export async function listPlans(input: {
  itemId: string;
  query: ListPlansQuery;
}): Promise<{ items: PlanDTO[]; total: number }> {
  const where: Prisma.PlanWhereInput = {
    itemId: input.itemId,
    deletedAt: null,
    ...(input.query.from && { scheduledDate: { gte: new Date(`${input.query.from}T00:00:00Z`) } }),
    ...(input.query.to && {
      scheduledDate: {
        ...(input.query.from && { gte: new Date(`${input.query.from}T00:00:00Z`) }),
        lte: new Date(`${input.query.to}T00:00:00Z`),
      },
    }),
  };
  const [rows, total] = await Promise.all([
    prisma.plan.findMany({
      where,
      orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
      include: PLAN_INCLUDE,
      take: input.query.limit,
      skip: input.query.offset,
    }),
    prisma.plan.count({ where }),
  ]);
  return { items: rows.map((r) => toPlanDTO(r, [])), total };
}

export async function getPlan(input: { itemId: string; planId: string }): Promise<PlanWithEventsDTO> {
  const row = await prisma.plan.findFirst({
    where: { id: input.planId, itemId: input.itemId, deletedAt: null },
    include: PLAN_INCLUDE,
  });
  if (!row) throw new ApiException('NOT_FOUND', 404, 'Plan not found.');
  return {
    plan: toPlanDTO(row, []),
    events: row.ballEvents.map(toEventDTO),
  };
}

// -----------------------------------------------------------------------------
// create / update / delete
// -----------------------------------------------------------------------------

async function assertMembersBelongToProject(input: {
  projectId: string;
  memberIds: string[];
}): Promise<void> {
  const found = await prisma.projectMember.findMany({
    where: { projectId: input.projectId, id: { in: input.memberIds }, deletedAt: null },
    select: { id: true },
  });
  if (found.length !== input.memberIds.length) {
    throw new ApiException(
      'INVALID_MEMBER',
      422,
      'Some member ids do not belong to this project.',
    );
  }
}

async function assertSuccessorAvailable(input: {
  successorPlanId: string;
  itemId: string;
  excludePlanId?: string;
}): Promise<void> {
  const target = await prisma.plan.findFirst({
    where: { id: input.successorPlanId, itemId: input.itemId, deletedAt: null },
    select: { id: true },
  });
  if (!target) {
    throw new ApiException(
      'SUCCESSOR_OUT_OF_SCOPE',
      422,
      'successorPlanId must reference a plan within the same item.',
    );
  }
  // 既に別 plan の successor として使われていないか
  const occupier = await prisma.plan.findFirst({
    where: {
      successorPlanId: input.successorPlanId,
      ...(input.excludePlanId && { id: { not: input.excludePlanId } }),
    },
    select: { id: true },
  });
  if (occupier) {
    throw new ApiException(
      'SUCCESSOR_ALREADY_USED',
      422,
      'successorPlanId is already used by another plan.',
    );
  }
}

export async function createPlan(input: {
  itemId: string;
  projectId: string;
  body: CreatePlanBody;
}): Promise<PlanDTO> {
  await assertMembersBelongToProject({
    projectId: input.projectId,
    memberIds: [input.body.fromMemberId, input.body.toMemberId],
  });
  if (input.body.successorPlanId) {
    await assertSuccessorAvailable({
      successorPlanId: input.body.successorPlanId,
      itemId: input.itemId,
    });
  }

  const row = await prisma.plan.create({
    data: {
      itemId: input.itemId,
      title: input.body.title,
      category: input.body.category,
      scheduledDate: new Date(`${input.body.scheduledDate}T00:00:00Z`),
      dueDate: input.body.dueDate ? new Date(`${input.body.dueDate}T00:00:00Z`) : null,
      fromMemberId: input.body.fromMemberId,
      toMemberId: input.body.toMemberId,
      successorPlanId: input.body.successorPlanId ?? null,
      memo: input.body.memo ?? null,
    },
    include: PLAN_INCLUDE,
  });
  return toPlanDTO(row, []);
}

export async function updatePlan(input: {
  itemId: string;
  planId: string;
  body: UpdatePlanBody;
}): Promise<PlanDTO> {
  const existing = await prisma.plan.findFirst({
    where: { id: input.planId, itemId: input.itemId, deletedAt: null },
  });
  if (!existing) throw new ApiException('NOT_FOUND', 404, 'Plan not found.');
  if (existing.status !== 'active') {
    throw new ApiException('PLAN_NOT_ACTIVE', 422, 'Plan is not editable.');
  }

  const data: Prisma.PlanUpdateInput = {};
  if (input.body.title !== undefined) data.title = input.body.title;
  if (input.body.category !== undefined) data.category = input.body.category;
  if (input.body.scheduledDate !== undefined)
    data.scheduledDate = new Date(`${input.body.scheduledDate}T00:00:00Z`);
  if (input.body.dueDate !== undefined)
    data.dueDate = input.body.dueDate ? new Date(`${input.body.dueDate}T00:00:00Z`) : null;
  if (input.body.memo !== undefined) data.memo = input.body.memo;

  const row = await prisma.plan.update({
    where: { id: input.planId },
    data,
    include: PLAN_INCLUDE,
  });
  return toPlanDTO(row, []);
}

export async function setPlanSuccessor(input: {
  itemId: string;
  planId: string;
  body: SetSuccessorBody;
}): Promise<PlanDTO> {
  const existing = await prisma.plan.findFirst({
    where: { id: input.planId, itemId: input.itemId, deletedAt: null },
  });
  if (!existing) throw new ApiException('NOT_FOUND', 404, 'Plan not found.');

  if (input.body.successorPlanId === null) {
    const row = await prisma.plan.update({
      where: { id: input.planId },
      data: { successorPlanId: null },
      include: PLAN_INCLUDE,
    });
    return toPlanDTO(row, []);
  }

  if (input.body.successorPlanId === input.planId) {
    throw new ApiException('SELF_SUCCESSOR', 422, 'A plan cannot be its own successor.');
  }
  await assertSuccessorAvailable({
    successorPlanId: input.body.successorPlanId,
    itemId: input.itemId,
    excludePlanId: input.planId,
  });

  const row = await prisma.plan.update({
    where: { id: input.planId },
    data: { successorPlanId: input.body.successorPlanId },
    include: PLAN_INCLUDE,
  });
  return toPlanDTO(row, []);
}

export async function deletePlan(input: { itemId: string; planId: string }): Promise<void> {
  const existing = await prisma.plan.findFirst({
    where: { id: input.planId, itemId: input.itemId, deletedAt: null },
    include: { ballEvents: { select: { id: true } } },
  });
  if (!existing) throw new ApiException('NOT_FOUND', 404, 'Plan not found.');

  // ball_events は append-only なので CASCADE 削除できない (FK ON DELETE RESTRICT)
  // → アプリ層で「ball_events が付いた予定は物理削除拒否」する。Phase 0 のシンプル運用。
  if (existing.ballEvents.length > 0) {
    throw new ApiException(
      'PLAN_HAS_EVENTS',
      409,
      'Plan has ball events; cancel instead of deleting (not yet supported).',
    );
  }

  // この plan を successor として指す先行 plan があれば自動的に SET NULL される (FK 設定済み)
  await prisma.plan.delete({ where: { id: input.planId } });
}
