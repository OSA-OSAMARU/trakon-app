import { prisma, type Prisma } from '@trakon/db';
import {
  deriveBallHolder,
  pickLatestBallEvent,
  type BallEventType,
  type PlanState,
} from '@trakon/shared';

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
  eventType: BallEventType;
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
  // 役割 (#131)
  executor: MemberRef | null;
  approver: MemberRef | null;
  progressManager: MemberRef | null;
  // TOSS 履歴スナップショット (#131 §14)
  fromMember: MemberRef | null;
  toMember: MemberRef | null;
  successorPlanId: string | null;
  status: 'active' | 'completed' | 'canceled';
  memo: string | null;
  ballHolder: MemberRef | null;
  ballState: PlanState;
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

type PlanRow = Prisma.PlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

function toEventDTO(ev: PlanRow['ballEvents'][number]): BallEventDTO {
  return {
    id: ev.id,
    eventType: ev.eventType as BallEventType,
    source: ev.source as 'human' | 'auto_chain',
    actor: toMemberRef(ev.actorMember),
    occurredAt: ev.occurredAt.toISOString(),
    note: ev.note,
  };
}

export function toPlanDTO(row: PlanRow, _members: PlanRow['fromMember'][] = []): PlanDTO {
  const executor = toMemberRef(row.executor);
  const approver = toMemberRef(row.approver);
  const progressManager = toMemberRef(row.progressManager);
  const fromMember = toMemberRef(row.fromMember);
  const toMember = toMemberRef(row.toMember);
  const eventsDesc = row.ballEvents; // already DESC
  const latest = pickLatestBallEvent(
    eventsDesc.map((e) => ({
      eventType: e.eventType as BallEventType,
      source: e.source as 'human' | 'auto_chain',
      occurredAt: e.occurredAt,
    })),
  );
  const holder = deriveBallHolder(
    {
      executorMemberId: row.executorMemberId,
      approverMemberId: row.approverMemberId,
      progressManagerMemberId: row.progressManagerMemberId,
      toMemberId: row.toMemberId,
      status: row.status as 'active' | 'completed' | 'canceled',
    },
    latest,
  );

  // holder.memberId を各ロール MemberRef に解決
  const byId: Array<MemberRef | null> = [executor, approver, progressManager, fromMember, toMember];
  const ballHolder = byId.find((m) => m && m.id === holder.memberId) ?? null;

  const latestEventDTO = eventsDesc[0] ? toEventDTO(eventsDesc[0]) : null;

  return {
    id: row.id,
    itemId: row.itemId,
    planType: row.planType as 'toss',
    title: row.title,
    category: row.category as PlanCategory,
    scheduledDate: toDateString(row.scheduledDate)!,
    dueDate: toDateString(row.dueDate),
    executor,
    approver,
    progressManager,
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

/**
 * プロジェクト配下の全制作物 (item) を横断してプランを取得する。
 * 制作物列スケジュール (SC-06, プロトタイプ準拠) で、全制作物を 1 つの縦型カレンダーに
 * 並べるために使用する。`from`/`to` は scheduledDate のレンジで絞り込む。
 */
export async function listProjectPlans(input: {
  projectId: string;
  query: { from?: string; to?: string };
}): Promise<{ items: PlanDTO[]; total: number }> {
  const where: Prisma.PlanWhereInput = {
    deletedAt: null,
    item: { projectId: input.projectId, deletedAt: null },
    ...((input.query.from || input.query.to) && {
      scheduledDate: {
        ...(input.query.from && { gte: new Date(`${input.query.from}T00:00:00Z`) }),
        ...(input.query.to && { lte: new Date(`${input.query.to}T00:00:00Z`) }),
      },
    }),
  };
  const rows = await prisma.plan.findMany({
    where,
    orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
    include: PLAN_INCLUDE,
  });
  return { items: rows.map((r) => toPlanDTO(r, [])), total: rows.length };
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

async function assertItemInProject(input: {
  projectId: string;
  itemId: string;
}): Promise<void> {
  const item = await prisma.projectItem.findFirst({
    where: { id: input.itemId, projectId: input.projectId, deletedAt: null },
    select: { id: true },
  });
  if (!item) {
    throw new ApiException(
      'INVALID_ITEM',
      422,
      'itemId does not belong to this project.',
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

/**
 * 進行責任者の初期値を解決する (#131)。body 指定 > プロジェクト既定 (project.progressManagerMemberId)。
 * どちらも無ければ null (アプリ層で TOSS 時に必須チェック)。
 */
async function resolveProgressManagerId(input: {
  projectId: string;
  bodyValue?: string | null;
}): Promise<string | null> {
  if (input.bodyValue !== undefined) return input.bodyValue ?? null;
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { progressManagerMemberId: true },
  });
  return project?.progressManagerMemberId ?? null;
}

export async function createPlan(input: {
  itemId: string;
  projectId: string;
  body: CreatePlanBody;
}): Promise<PlanDTO> {
  const progressManagerMemberId = await resolveProgressManagerId({
    projectId: input.projectId,
    bodyValue: input.body.progressManagerMemberId,
  });

  await assertMembersBelongToProject({
    projectId: input.projectId,
    // 任意項目のため、指定されたものだけ検証する (#55 / #131)
    memberIds: [
      input.body.executorMemberId,
      input.body.approverMemberId,
      progressManagerMemberId,
    ].filter((id): id is string => !!id),
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
      executorMemberId: input.body.executorMemberId ?? null,
      approverMemberId: input.body.approverMemberId ?? null,
      progressManagerMemberId,
      // FROM/TO は TOSS 実行時に履歴として書き込む (#131 §14)。作成時は未設定。
      successorPlanId: input.body.successorPlanId ?? null,
      memo: input.body.memo ?? null,
    },
    include: PLAN_INCLUDE,
  });
  return toPlanDTO(row, []);
}

/**
 * 既存予定を複製する (#51)。同一制作物・同一期間・同内容で ready 状態の新規予定を作る。
 * successorPlanId と ballEvents (履歴) はコピーしない (新規予定は未TOSS)。
 */
export async function duplicatePlan(input: {
  itemId: string;
  planId: string;
}): Promise<PlanDTO> {
  const source = await prisma.plan.findFirst({
    where: { id: input.planId, itemId: input.itemId, deletedAt: null },
  });
  if (!source) throw new ApiException('NOT_FOUND', 404, 'Plan not found.');

  const row = await prisma.plan.create({
    data: {
      itemId: source.itemId,
      title: source.title,
      category: source.category,
      scheduledDate: source.scheduledDate,
      dueDate: source.dueDate,
      // 役割はコピーする。FROM/TO 履歴・後続・ballEvents はコピーしない (新規は未TOSS)。
      executorMemberId: source.executorMemberId,
      approverMemberId: source.approverMemberId,
      progressManagerMemberId: source.progressManagerMemberId,
      memo: source.memo,
    },
    include: PLAN_INCLUDE,
  });
  return toPlanDTO(row, []);
}

export async function updatePlan(input: {
  itemId: string;
  planId: string;
  projectId: string;
  body: UpdatePlanBody;
}): Promise<PlanDTO> {
  const existing = await prisma.plan.findFirst({
    where: { id: input.planId, itemId: input.itemId, deletedAt: null },
    include: {
      ballEvents: { orderBy: { occurredAt: 'desc' }, select: { eventType: true } },
    },
  });
  if (!existing) throw new ApiException('NOT_FOUND', 404, 'Plan not found.');
  if (existing.status !== 'active') {
    throw new ApiException('PLAN_NOT_ACTIVE', 422, 'Plan is not editable.');
  }

  // PlanUncheckedUpdateInput を使うことでスカラ FK (fromMemberId 等) を直接指定できる。
  const data: Prisma.PlanUncheckedUpdateInput = {};

  // 別制作物への移動 (#52)。移動すると同一item前提の successor 紐付けが壊れるため、
  // 自分の successor と、自分を指す先行予定の紐付けを自動解除する。
  const movingItem =
    input.body.itemId !== undefined && input.body.itemId !== existing.itemId;
  if (movingItem) {
    await assertItemInProject({
      projectId: input.projectId,
      itemId: input.body.itemId!,
    });
    data.itemId = input.body.itemId!;
    data.successorPlanId = null;
    await prisma.plan.updateMany({
      where: { successorPlanId: input.planId },
      data: { successorPlanId: null },
    });
  }

  if (input.body.title !== undefined) data.title = input.body.title;
  if (input.body.category !== undefined) data.category = input.body.category;
  if (input.body.scheduledDate !== undefined)
    data.scheduledDate = new Date(`${input.body.scheduledDate}T00:00:00Z`);
  if (input.body.dueDate !== undefined)
    data.dueDate = input.body.dueDate ? new Date(`${input.body.dueDate}T00:00:00Z`) : null;
  if (input.body.memo !== undefined) data.memo = input.body.memo;

  // 役割の編集可否 (#131)。ball の進み具合で制限する。
  //   実施者/承認者: 実施中・差し戻し のうちのみ変更可 (確認依頼/承認後はロック)。
  //   進行責任者: TOSS 前ならいつでも変更可 (§9「予定ごとに変更可能」)。
  const latest = existing.ballEvents[0];
  const t = latest?.eventType;
  // 実施中/差し戻し = 最新が無い or review_request_undone / sent_back / toss_undone(レガシー)
  const rolesEditable =
    !t || t === 'review_request_undone' || t === 'sent_back' || t === 'toss_undone';
  // TOSS 済み = tossed / completion_undone(レガシー)
  const tossed = t === 'tossed' || t === 'completion_undone';

  if (input.body.executorMemberId !== undefined || input.body.approverMemberId !== undefined) {
    if (!rolesEditable) {
      throw new ApiException(
        'ROLES_LOCKED',
        422,
        '確認依頼・承認後は実施者/承認者を変更できません。',
      );
    }
    const changed = [input.body.executorMemberId, input.body.approverMemberId].filter(
      (id): id is string => !!id,
    );
    await assertMembersBelongToProject({ projectId: input.projectId, memberIds: changed });
    if (input.body.executorMemberId !== undefined) data.executorMemberId = input.body.executorMemberId;
    if (input.body.approverMemberId !== undefined) data.approverMemberId = input.body.approverMemberId;
  }

  if (input.body.progressManagerMemberId !== undefined) {
    if (tossed) {
      throw new ApiException(
        'ROLES_LOCKED',
        422,
        'TOSS 済みの予定は進行責任者を変更できません。',
      );
    }
    if (input.body.progressManagerMemberId) {
      await assertMembersBelongToProject({
        projectId: input.projectId,
        memberIds: [input.body.progressManagerMemberId],
      });
    }
    data.progressManagerMemberId = input.body.progressManagerMemberId;
  }

  // 後続の予定 (setPlanSuccessor と同じ検証ロジック)。
  // 別制作物へ移動する場合はクロスitem参照を防ぐため successor 指定を無視する (上で null 化済み)。
  if (!movingItem && input.body.successorPlanId !== undefined) {
    if (input.body.successorPlanId === null) {
      data.successorPlanId = null;
    } else {
      if (input.body.successorPlanId === input.planId) {
        throw new ApiException('SELF_SUCCESSOR', 422, 'A plan cannot be its own successor.');
      }
      await assertSuccessorAvailable({
        successorPlanId: input.body.successorPlanId,
        itemId: input.itemId,
        excludePlanId: input.planId,
      });
      data.successorPlanId = input.body.successorPlanId;
    }
  }

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
