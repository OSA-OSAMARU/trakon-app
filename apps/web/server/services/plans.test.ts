import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  createPlan as CreatePlanType,
  deletePlan as DeletePlanType,
  duplicatePlan as DuplicatePlanType,
  getPlan as GetPlanType,
  listPlans as ListPlansType,
  listProjectPlans as ListProjectPlansType,
  setPlanSuccessor as SetPlanSuccessorType,
  toPlanDTO as ToPlanDTOType,
  updatePlan as UpdatePlanType,
} from './plans.js';

// =============================================================================
// インメモリ Prisma モック
// =============================================================================

type MockMember = {
  id: string;
  name: string;
  organizationName: string;
  memberType: string;
  projectId: string;
  deletedAt: Date | null;
};
type MockItem = {
  id: string;
  projectId: string;
  deletedAt: Date | null;
};
type MockProject = {
  id: string;
  progressManagerMemberId: string | null;
};
type MockBallEvent = {
  id: string;
  planId: string;
  eventType: string;
  source: string;
  actorMemberId: string | null;
  occurredAt: Date;
  note: string | null;
};
type MockPlan = {
  id: string;
  itemId: string;
  planType: string;
  title: string;
  category: string;
  scheduledDate: Date;
  dueDate: Date | null;
  // 役割 (#131)
  executorMemberId: string | null;
  approverMemberId: string | null;
  progressManagerMemberId: string | null;
  // TOSS 履歴スナップショット
  fromMemberId: string | null;
  toMemberId: string | null;
  successorPlanId: string | null;
  status: string;
  memo: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

const memberStore: MockMember[] = [];
const itemStore: MockItem[] = [];
const projectStore: MockProject[] = [];
const planStore: MockPlan[] = [];
const ballEventStore: MockBallEvent[] = [];

let nextId = 1;
const newId = (prefix: string) => `${prefix}-${nextId++}`;

const findMember = (id: string | null) =>
  id ? (memberStore.find((m) => m.id === id) ?? null) : null;

// plan を service が読む include 形 (役割 + TOSS履歴 + ballEvents) に組み立てる。
function hydratePlan(p: MockPlan) {
  const events = ballEventStore
    .filter((e) => e.planId === p.id)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .map((e) => ({
      ...e,
      actorMember: e.actorMemberId
        ? (memberStore.find((m) => m.id === e.actorMemberId) ?? null)
        : null,
    }));
  return {
    ...p,
    executor: findMember(p.executorMemberId),
    approver: findMember(p.approverMemberId),
    progressManager: findMember(p.progressManagerMemberId),
    fromMember: findMember(p.fromMemberId),
    toMember: findMember(p.toMemberId),
    ballEvents: events,
  };
}

// scheduledDate gte/lte と createdAt asc に基づく簡易フィルタ・ソート。
function matchScheduled(
  date: Date,
  cond: { gte?: Date; lte?: Date } | undefined,
): boolean {
  if (!cond) return true;
  if (cond.gte && date.getTime() < cond.gte.getTime()) return false;
  if (cond.lte && date.getTime() > cond.lte.getTime()) return false;
  return true;
}

type PlanWhere = {
  id?: string | { not?: string };
  itemId?: string;
  deletedAt?: null;
  successorPlanId?: string | null;
  scheduledDate?: { gte?: Date; lte?: Date };
  item?: { projectId?: string; deletedAt?: null };
};
type MemberWhere = {
  projectId?: string;
  deletedAt?: null;
  id?: { in?: string[] };
};
type ItemWhere = {
  id?: string;
  projectId?: string;
  deletedAt?: null;
};
type PlanData = Partial<MockPlan> & Record<string, unknown>;

const prismaMock = {
  plan: {
    findMany: vi.fn(
      async ({ where, take, skip }: { where: PlanWhere; take?: number; skip?: number }) => {
      let rows = planStore.filter((p) => {
        if (where.deletedAt === null && p.deletedAt !== null) return false;
        if (where.itemId !== undefined && p.itemId !== where.itemId) return false;
        if (where.item) {
          const item = itemStore.find((i) => i.id === p.itemId);
          if (!item) return false;
          if (where.item.projectId !== undefined && item.projectId !== where.item.projectId)
            return false;
          if (where.item.deletedAt === null && item.deletedAt !== null) return false;
        }
        if (!matchScheduled(p.scheduledDate, where.scheduledDate)) return false;
        return true;
      });
      rows = rows.sort(
        (a, b) =>
          a.scheduledDate.getTime() - b.scheduledDate.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const start = skip ?? 0;
      const end = take !== undefined ? start + take : undefined;
      return rows.slice(start, end).map(hydratePlan);
    }),
    count: vi.fn(async ({ where }: { where: PlanWhere }) => {
      return planStore.filter((p) => {
        if (where.deletedAt === null && p.deletedAt !== null) return false;
        if (where.itemId !== undefined && p.itemId !== where.itemId) return false;
        if (!matchScheduled(p.scheduledDate, where.scheduledDate)) return false;
        return true;
      }).length;
    }),
    findFirst: vi.fn(async ({ where }: { where: PlanWhere }) => {
      const row = planStore.find((p) => {
        if (where.id !== undefined) {
          if (typeof where.id === 'object' && where.id.not !== undefined) {
            if (p.id === where.id.not) return false;
          } else if (p.id !== where.id) {
            return false;
          }
        }
        if (where.itemId !== undefined && p.itemId !== where.itemId) return false;
        if (where.deletedAt === null && p.deletedAt !== null) return false;
        if (where.successorPlanId !== undefined && p.successorPlanId !== where.successorPlanId)
          return false;
        return true;
      });
      return row ? hydratePlan(row) : null;
    }),
    create: vi.fn(async ({ data }: { data: PlanData }) => {
      const now = new Date('2026-06-01T00:00:00Z');
      const p: MockPlan = {
        id: newId('p'),
        itemId: data.itemId as string,
        planType: 'toss',
        title: data.title as string,
        category: data.category as string,
        scheduledDate: data.scheduledDate as Date,
        dueDate: (data.dueDate as Date | null) ?? null,
        executorMemberId: (data.executorMemberId as string | null) ?? null,
        approverMemberId: (data.approverMemberId as string | null) ?? null,
        progressManagerMemberId: (data.progressManagerMemberId as string | null) ?? null,
        fromMemberId: (data.fromMemberId as string | null) ?? null,
        toMemberId: (data.toMemberId as string | null) ?? null,
        successorPlanId: (data.successorPlanId as string | null) ?? null,
        status: 'active',
        memo: (data.memo as string | null) ?? null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      planStore.push(p);
      return hydratePlan(p);
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: PlanData }) => {
      const p = planStore.find((x) => x.id === where.id);
      if (!p) throw new Error('not found');
      for (const key of Object.keys(data)) {
        (p as Record<string, unknown>)[key] = data[key];
      }
      p.updatedAt = new Date('2026-06-02T00:00:00Z');
      return hydratePlan(p);
    }),
    updateMany: vi.fn(async ({ where, data }: { where: PlanWhere; data: PlanData }) => {
      let count = 0;
      for (const p of planStore) {
        if (where.successorPlanId !== undefined && p.successorPlanId === where.successorPlanId) {
          for (const key of Object.keys(data)) (p as Record<string, unknown>)[key] = data[key];
          count++;
        }
      }
      return { count };
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const idx = planStore.findIndex((p) => p.id === where.id);
      if (idx === -1) throw new Error('not found');
      const [removed] = planStore.splice(idx, 1);
      // FK SET NULL の模倣
      for (const p of planStore) {
        if (p.successorPlanId === removed!.id) p.successorPlanId = null;
      }
      return removed;
    }),
  },
  projectMember: {
    findMany: vi.fn(async ({ where }: { where: MemberWhere }) => {
      return memberStore.filter((m) => {
        if (where.projectId !== undefined && m.projectId !== where.projectId) return false;
        if (where.deletedAt === null && m.deletedAt !== null) return false;
        if (where.id?.in && !where.id.in.includes(m.id)) return false;
        return true;
      });
    }),
  },
  projectItem: {
    findFirst: vi.fn(async ({ where }: { where: ItemWhere }) => {
      const item = itemStore.find((i) => {
        if (where.id !== undefined && i.id !== where.id) return false;
        if (where.projectId !== undefined && i.projectId !== where.projectId) return false;
        if (where.deletedAt === null && i.deletedAt !== null) return false;
        return true;
      });
      return item ?? null;
    }),
  },
  project: {
    // createPlan の進行責任者デフォルト解決 (resolveProgressManagerId) で使う。
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return projectStore.find((p) => p.id === where.id) ?? null;
    }),
  },
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// =============================================================================
// テスト本体
// =============================================================================

let createPlan: typeof CreatePlanType;
let deletePlan: typeof DeletePlanType;
let duplicatePlan: typeof DuplicatePlanType;
let getPlan: typeof GetPlanType;
let listPlans: typeof ListPlansType;
let listProjectPlans: typeof ListProjectPlansType;
let setPlanSuccessor: typeof SetPlanSuccessorType;
let toPlanDTO: typeof ToPlanDTOType;
let updatePlan: typeof UpdatePlanType;

beforeAll(async () => {
  ({
    createPlan,
    deletePlan,
    duplicatePlan,
    getPlan,
    listPlans,
    listProjectPlans,
    setPlanSuccessor,
    toPlanDTO,
    updatePlan,
  } = await import('./plans.js'));
});

afterEach(() => {
  memberStore.length = 0;
  itemStore.length = 0;
  projectStore.length = 0;
  planStore.length = 0;
  ballEventStore.length = 0;
  vi.clearAllMocks();
});

// --- テスト用ファクトリ -------------------------------------------------------

const PROJECT_ID = 'proj-1';
const ITEM_ID = 'item-1';

function seedItem(overrides: Partial<MockItem> = {}): MockItem {
  const item: MockItem = {
    id: ITEM_ID,
    projectId: PROJECT_ID,
    deletedAt: null,
    ...overrides,
  };
  itemStore.push(item);
  return item;
}

function seedMember(overrides: Partial<MockMember> = {}): MockMember {
  const m: MockMember = {
    id: newId('m'),
    name: 'メンバー',
    organizationName: '組織',
    memberType: 'production',
    projectId: PROJECT_ID,
    deletedAt: null,
    ...overrides,
  };
  memberStore.push(m);
  return m;
}

function seedProject(overrides: Partial<MockProject> = {}): MockProject {
  const p: MockProject = {
    id: PROJECT_ID,
    progressManagerMemberId: null,
    ...overrides,
  };
  projectStore.push(p);
  return p;
}

function seedPlan(overrides: Partial<MockPlan> = {}): MockPlan {
  const now = new Date('2026-06-01T00:00:00Z');
  const p: MockPlan = {
    id: newId('p'),
    itemId: ITEM_ID,
    planType: 'toss',
    title: 'タイトル',
    category: 'design',
    scheduledDate: new Date('2026-06-10T00:00:00Z'),
    dueDate: null,
    executorMemberId: null,
    approverMemberId: null,
    progressManagerMemberId: null,
    fromMemberId: null,
    toMemberId: null,
    successorPlanId: null,
    status: 'active',
    memo: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
  planStore.push(p);
  return p;
}

function seedBallEvent(overrides: Partial<MockBallEvent> = {}): MockBallEvent {
  const e: MockBallEvent = {
    id: newId('be'),
    planId: 'p-x',
    eventType: 'tossed',
    source: 'human',
    actorMemberId: null,
    occurredAt: new Date('2026-06-05T00:00:00Z'),
    note: null,
    ...overrides,
  };
  ballEventStore.push(e);
  return e;
}

// =============================================================================
// toPlanDTO (純粋な変換 + deriveBallHolder の分岐)
// =============================================================================

describe('toPlanDTO', () => {
  it('イベントなしは in_progress で実施者がホルダー', () => {
    const exec = seedMember();
    const approver = seedMember();
    const pm = seedMember();
    const plan = seedPlan({
      executorMemberId: exec.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
      dueDate: new Date('2026-06-20T00:00:00Z'),
      memo: 'メモ',
    });
    const dto = toPlanDTO(hydratePlan(plan) as Parameters<typeof ToPlanDTOType>[0], []);
    expect(dto.ballState).toBe('in_progress');
    expect(dto.ballHolder?.id).toBe(exec.id);
    expect(dto.executor?.id).toBe(exec.id);
    expect(dto.approver?.id).toBe(approver.id);
    expect(dto.progressManager?.id).toBe(pm.id);
    // 作成直後は FROM/TO 履歴は未設定。
    expect(dto.fromMember).toBeNull();
    expect(dto.toMember).toBeNull();
    expect(dto.dueDate).toBe('2026-06-20');
    expect(dto.memo).toBe('メモ');
    expect(dto.latestEvent).toBeNull();
    expect(dto.completedAt).toBeNull();
  });

  it('最新が review_requested は review_pending で承認者がホルダー', () => {
    const exec = seedMember();
    const approver = seedMember();
    const plan = seedPlan({ executorMemberId: exec.id, approverMemberId: approver.id });
    seedBallEvent({ planId: plan.id, eventType: 'review_requested', actorMemberId: exec.id, note: '確認願います' });
    const dto = toPlanDTO(hydratePlan(plan) as Parameters<typeof ToPlanDTOType>[0], []);
    expect(dto.ballState).toBe('review_pending');
    expect(dto.ballHolder?.id).toBe(approver.id);
    expect(dto.latestEvent?.eventType).toBe('review_requested');
    expect(dto.latestEvent?.actor?.id).toBe(exec.id);
    expect(dto.latestEvent?.note).toBe('確認願います');
  });

  it('最新が approved は approved で進行責任者がホルダー', () => {
    const exec = seedMember();
    const pm = seedMember();
    const plan = seedPlan({ executorMemberId: exec.id, progressManagerMemberId: pm.id });
    seedBallEvent({ planId: plan.id, eventType: 'approved', occurredAt: new Date('2026-06-06T00:00:00Z') });
    const dto = toPlanDTO(hydratePlan(plan) as Parameters<typeof ToPlanDTOType>[0], []);
    expect(dto.ballState).toBe('approved');
    expect(dto.ballHolder?.id).toBe(pm.id);
  });

  it('最新が sent_back は sent_back で実施者がホルダー', () => {
    const exec = seedMember();
    const approver = seedMember();
    const plan = seedPlan({ executorMemberId: exec.id, approverMemberId: approver.id });
    seedBallEvent({ planId: plan.id, eventType: 'review_requested', occurredAt: new Date('2026-06-05T00:00:00Z') });
    seedBallEvent({ planId: plan.id, eventType: 'sent_back', occurredAt: new Date('2026-06-06T00:00:00Z'), note: '修正して' });
    const dto = toPlanDTO(hydratePlan(plan) as Parameters<typeof ToPlanDTOType>[0], []);
    expect(dto.ballState).toBe('sent_back');
    expect(dto.ballHolder?.id).toBe(exec.id);
  });

  it('最新が tossed は tossed で toMember 履歴がホルダー', () => {
    const pm = seedMember();
    const successorExec = seedMember();
    const plan = seedPlan({
      progressManagerMemberId: pm.id,
      // TOSS 実行時に書き込まれる履歴スナップショット。
      fromMemberId: pm.id,
      toMemberId: successorExec.id,
    });
    seedBallEvent({ planId: plan.id, eventType: 'approved', occurredAt: new Date('2026-06-05T00:00:00Z') });
    seedBallEvent({ planId: plan.id, eventType: 'tossed', actorMemberId: pm.id, occurredAt: new Date('2026-06-06T00:00:00Z') });
    const dto = toPlanDTO(hydratePlan(plan) as Parameters<typeof ToPlanDTOType>[0], []);
    expect(dto.ballState).toBe('tossed');
    expect(dto.ballHolder?.id).toBe(successorExec.id);
    expect(dto.fromMember?.id).toBe(pm.id);
    expect(dto.toMember?.id).toBe(successorExec.id);
    expect(dto.latestEvent?.eventType).toBe('tossed');
  });

  it('最新が completed (レガシー) は completed で toMember がホルダー (completedAt あり)', () => {
    const pm = seedMember();
    const to = seedMember();
    const plan = seedPlan({
      progressManagerMemberId: pm.id,
      toMemberId: to.id,
      status: 'completed',
      completedAt: new Date('2026-06-12T03:00:00Z'),
    });
    seedBallEvent({ planId: plan.id, eventType: 'tossed', occurredAt: new Date('2026-06-05T00:00:00Z') });
    seedBallEvent({ planId: plan.id, eventType: 'completed', occurredAt: new Date('2026-06-12T03:00:00Z') });
    const dto = toPlanDTO(hydratePlan(plan) as Parameters<typeof ToPlanDTOType>[0], []);
    expect(dto.ballState).toBe('completed');
    expect(dto.ballHolder?.id).toBe(to.id);
    expect(dto.completedAt).toBe('2026-06-12T03:00:00.000Z');
  });

  it('最新が review_request_undone は in_progress に戻り実施者がホルダー', () => {
    const exec = seedMember();
    const approver = seedMember();
    const plan = seedPlan({ executorMemberId: exec.id, approverMemberId: approver.id });
    seedBallEvent({ planId: plan.id, eventType: 'review_requested', occurredAt: new Date('2026-06-05T00:00:00Z') });
    seedBallEvent({ planId: plan.id, eventType: 'review_request_undone', occurredAt: new Date('2026-06-06T00:00:00Z') });
    const dto = toPlanDTO(hydratePlan(plan) as Parameters<typeof ToPlanDTOType>[0], []);
    expect(dto.ballState).toBe('in_progress');
    expect(dto.ballHolder?.id).toBe(exec.id);
  });

  it('ホルダー member_id が解決できない場合は null', () => {
    const pm = seedMember();
    const plan = seedPlan({ progressManagerMemberId: pm.id, toMemberId: 'ghost' });
    seedBallEvent({ planId: plan.id, eventType: 'tossed' });
    const hydrated = hydratePlan(plan) as Parameters<typeof ToPlanDTOType>[0];
    hydrated.toMember = null;
    const dto = toPlanDTO(hydrated, []);
    expect(dto.ballHolder).toBeNull();
  });
});

// =============================================================================
// listPlans
// =============================================================================

describe('listPlans', () => {
  it('item 配下の active な予定を返す (空配列も可)', async () => {
    seedItem();
    const res = await listPlans({ itemId: ITEM_ID, query: { limit: 50, offset: 0 } });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('scheduledDate と createdAt 昇順でソートする', async () => {
    seedPlan({ id: 'pa', scheduledDate: new Date('2026-06-15T00:00:00Z') });
    seedPlan({ id: 'pb', scheduledDate: new Date('2026-06-10T00:00:00Z') });
    const res = await listPlans({ itemId: ITEM_ID, query: { limit: 50, offset: 0 } });
    expect(res.items.map((i) => i.id)).toEqual(['pb', 'pa']);
    expect(res.total).toBe(2);
  });

  it('from/to レンジで絞り込む', async () => {
    seedPlan({ id: 'p-early', scheduledDate: new Date('2026-06-01T00:00:00Z') });
    seedPlan({ id: 'p-mid', scheduledDate: new Date('2026-06-10T00:00:00Z') });
    seedPlan({ id: 'p-late', scheduledDate: new Date('2026-06-20T00:00:00Z') });
    const res = await listPlans({
      itemId: ITEM_ID,
      query: { from: '2026-06-05', to: '2026-06-15', limit: 50, offset: 0 },
    });
    expect(res.items.map((i) => i.id)).toEqual(['p-mid']);
  });

  it('from のみ指定 (gte) で絞り込む', async () => {
    seedPlan({ id: 'p-early', scheduledDate: new Date('2026-06-01T00:00:00Z') });
    seedPlan({ id: 'p-late', scheduledDate: new Date('2026-06-20T00:00:00Z') });
    const res = await listPlans({
      itemId: ITEM_ID,
      query: { from: '2026-06-10', limit: 50, offset: 0 },
    });
    expect(res.items.map((i) => i.id)).toEqual(['p-late']);
  });

  it('limit/offset でページングする', async () => {
    seedPlan({ id: 'p1', scheduledDate: new Date('2026-06-10T00:00:00Z') });
    seedPlan({ id: 'p2', scheduledDate: new Date('2026-06-11T00:00:00Z') });
    seedPlan({ id: 'p3', scheduledDate: new Date('2026-06-12T00:00:00Z') });
    const res = await listPlans({ itemId: ITEM_ID, query: { limit: 1, offset: 1 } });
    expect(res.items.map((i) => i.id)).toEqual(['p2']);
    expect(res.total).toBe(3);
  });
});

// =============================================================================
// listProjectPlans
// =============================================================================

describe('listProjectPlans', () => {
  it('プロジェクト配下の全 item を横断して返す', async () => {
    seedItem({ id: 'item-a' });
    seedItem({ id: 'item-b' });
    seedPlan({ id: 'pa', itemId: 'item-a', scheduledDate: new Date('2026-06-10T00:00:00Z') });
    seedPlan({ id: 'pb', itemId: 'item-b', scheduledDate: new Date('2026-06-11T00:00:00Z') });
    // 別プロジェクトの item は対象外
    seedItem({ id: 'item-other', projectId: 'proj-2' });
    seedPlan({ id: 'pc', itemId: 'item-other', scheduledDate: new Date('2026-06-09T00:00:00Z') });
    const res = await listProjectPlans({ projectId: PROJECT_ID, query: {} });
    expect(res.items.map((i) => i.id)).toEqual(['pa', 'pb']);
    expect(res.total).toBe(2);
  });

  it('from/to レンジで絞り込む', async () => {
    seedItem({ id: 'item-a' });
    seedPlan({ id: 'pa', itemId: 'item-a', scheduledDate: new Date('2026-06-01T00:00:00Z') });
    seedPlan({ id: 'pb', itemId: 'item-a', scheduledDate: new Date('2026-06-20T00:00:00Z') });
    const res = await listProjectPlans({
      projectId: PROJECT_ID,
      query: { from: '2026-06-10' },
    });
    expect(res.items.map((i) => i.id)).toEqual(['pb']);
  });

  it('to のみ指定でも絞り込む', async () => {
    seedItem({ id: 'item-a' });
    seedPlan({ id: 'pa', itemId: 'item-a', scheduledDate: new Date('2026-06-01T00:00:00Z') });
    seedPlan({ id: 'pb', itemId: 'item-a', scheduledDate: new Date('2026-06-20T00:00:00Z') });
    const res = await listProjectPlans({
      projectId: PROJECT_ID,
      query: { to: '2026-06-10' },
    });
    expect(res.items.map((i) => i.id)).toEqual(['pa']);
  });
});

// =============================================================================
// getPlan
// =============================================================================

describe('getPlan', () => {
  it('plan と events を返す', async () => {
    const plan = seedPlan();
    seedBallEvent({ planId: plan.id, eventType: 'tossed', occurredAt: new Date('2026-06-05T00:00:00Z') });
    seedBallEvent({ planId: plan.id, eventType: 'completed', occurredAt: new Date('2026-06-06T00:00:00Z') });
    const res = await getPlan({ itemId: ITEM_ID, planId: plan.id });
    expect(res.plan.id).toBe(plan.id);
    expect(res.events).toHaveLength(2);
    // DESC 順
    expect(res.events[0]!.eventType).toBe('completed');
  });

  it('存在しなければ 404 NOT_FOUND', async () => {
    await expect(getPlan({ itemId: ITEM_ID, planId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

// =============================================================================
// createPlan
// =============================================================================

describe('createPlan', () => {
  it('ロール指定なしで作成でき、進行責任者はプロジェクト既定値を解決する (#55/#131)', async () => {
    const defaultPm = seedMember();
    seedProject({ progressManagerMemberId: defaultPm.id });
    const dto = await createPlan({
      itemId: ITEM_ID,
      projectId: PROJECT_ID,
      body: { title: '新規', category: 'design', scheduledDate: '2026-06-10' } satisfies Parameters<
        typeof CreatePlanType
      >[0]['body'],
    });
    expect(dto.title).toBe('新規');
    expect(dto.executor).toBeNull();
    expect(dto.approver).toBeNull();
    // 進行責任者はプロジェクト既定値で埋まる。
    expect(dto.progressManager?.id).toBe(defaultPm.id);
    expect(dto.scheduledDate).toBe('2026-06-10');
  });

  it('プロジェクト既定の進行責任者が無ければ progressManager は null', async () => {
    seedProject({ progressManagerMemberId: null });
    const dto = await createPlan({
      itemId: ITEM_ID,
      projectId: PROJECT_ID,
      body: { title: '新規', category: 'design', scheduledDate: '2026-06-10' } satisfies Parameters<
        typeof CreatePlanType
      >[0]['body'],
    });
    expect(dto.progressManager).toBeNull();
  });

  it('役割/dueDate/memo/successor を指定して作成できる', async () => {
    const exec = seedMember();
    const approver = seedMember();
    const pm = seedMember();
    const succ = seedPlan({ id: 'succ' });
    const dto = await createPlan({
      itemId: ITEM_ID,
      projectId: PROJECT_ID,
      body: {
        title: '新規',
        category: 'coding',
        scheduledDate: '2026-06-10',
        dueDate: '2026-06-20',
        executorMemberId: exec.id,
        approverMemberId: approver.id,
        progressManagerMemberId: pm.id,
        successorPlanId: succ.id,
        memo: 'メモ',
      } satisfies Parameters<typeof CreatePlanType>[0]['body'],
    });
    expect(dto.executor?.id).toBe(exec.id);
    expect(dto.approver?.id).toBe(approver.id);
    expect(dto.progressManager?.id).toBe(pm.id);
    expect(dto.dueDate).toBe('2026-06-20');
    expect(dto.successorPlanId).toBe('succ');
  });

  it('メンバーがプロジェクトに属さなければ 422 INVALID_MEMBER', async () => {
    await expect(
      createPlan({
        itemId: ITEM_ID,
        projectId: PROJECT_ID,
        body: {
          title: '新規',
          category: 'design',
          scheduledDate: '2026-06-10',
          executorMemberId: 'ghost',
        } satisfies Parameters<typeof CreatePlanType>[0]['body'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MEMBER', status: 422 });
  });

  it('successor が同一 item に無ければ 422 SUCCESSOR_OUT_OF_SCOPE', async () => {
    await expect(
      createPlan({
        itemId: ITEM_ID,
        projectId: PROJECT_ID,
        body: {
          title: '新規',
          category: 'design',
          scheduledDate: '2026-06-10',
          successorPlanId: 'ghost',
        } satisfies Parameters<typeof CreatePlanType>[0]['body'],
      }),
    ).rejects.toMatchObject({ code: 'SUCCESSOR_OUT_OF_SCOPE', status: 422 });
  });

  it('successor が他予定に既に使われていれば 422 SUCCESSOR_ALREADY_USED', async () => {
    const succ = seedPlan({ id: 'succ' });
    seedPlan({ id: 'occupier', successorPlanId: succ.id });
    await expect(
      createPlan({
        itemId: ITEM_ID,
        projectId: PROJECT_ID,
        body: {
          title: '新規',
          category: 'design',
          scheduledDate: '2026-06-10',
          successorPlanId: succ.id,
        } satisfies Parameters<typeof CreatePlanType>[0]['body'],
      }),
    ).rejects.toMatchObject({ code: 'SUCCESSOR_ALREADY_USED', status: 422 });
  });
});

// =============================================================================
// duplicatePlan
// =============================================================================

describe('duplicatePlan', () => {
  it('同内容・in_progress 状態の新規予定を作る (successor/FROM/TO 履歴はコピーしない)', async () => {
    const exec = seedMember();
    const approver = seedMember();
    const pm = seedMember();
    const source = seedPlan({
      title: '元',
      category: 'review',
      executorMemberId: exec.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
      // FROM/TO 履歴が付いていてもコピーしない。
      fromMemberId: pm.id,
      toMemberId: exec.id,
      successorPlanId: 'something',
      memo: 'メモ',
      dueDate: new Date('2026-06-20T00:00:00Z'),
    });
    seedBallEvent({ planId: source.id, eventType: 'tossed' });
    const dto = await duplicatePlan({ itemId: ITEM_ID, planId: source.id });
    expect(dto.id).not.toBe(source.id);
    expect(dto.title).toBe('元');
    // 役割はコピーする。
    expect(dto.executor?.id).toBe(exec.id);
    expect(dto.approver?.id).toBe(approver.id);
    expect(dto.progressManager?.id).toBe(pm.id);
    expect(dto.memo).toBe('メモ');
    // FROM/TO 履歴・後続・イベントはコピーしない (新規は未TOSS)。
    expect(dto.fromMember).toBeNull();
    expect(dto.toMember).toBeNull();
    expect(dto.successorPlanId).toBeNull();
    expect(dto.ballState).toBe('in_progress');
    expect(dto.latestEvent).toBeNull();
  });

  it('存在しなければ 404 NOT_FOUND', async () => {
    await expect(duplicatePlan({ itemId: ITEM_ID, planId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

// =============================================================================
// updatePlan
// =============================================================================

describe('updatePlan', () => {
  it('タイトル/カテゴリ/期間/memo を更新できる', async () => {
    const plan = seedPlan({ title: '旧' });
    const dto = await updatePlan({
      itemId: ITEM_ID,
      planId: plan.id,
      projectId: PROJECT_ID,
      body: {
        title: '新',
        category: 'meeting',
        scheduledDate: '2026-06-15',
        dueDate: '2026-06-25',
        memo: '更新メモ',
      } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
    });
    expect(dto.title).toBe('新');
    expect(dto.category).toBe('meeting');
    expect(dto.scheduledDate).toBe('2026-06-15');
    expect(dto.dueDate).toBe('2026-06-25');
    expect(dto.memo).toBe('更新メモ');
  });

  it('dueDate を null に更新できる', async () => {
    const plan = seedPlan({ dueDate: new Date('2026-06-20T00:00:00Z') });
    const dto = await updatePlan({
      itemId: ITEM_ID,
      planId: plan.id,
      projectId: PROJECT_ID,
      body: { dueDate: null } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
    });
    expect(dto.dueDate).toBeNull();
  });

  it('存在しなければ 404 NOT_FOUND', async () => {
    await expect(
      updatePlan({
        itemId: ITEM_ID,
        planId: 'nope',
        projectId: PROJECT_ID,
        body: { title: 'x' } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('active 以外は 422 PLAN_NOT_ACTIVE', async () => {
    const plan = seedPlan({ status: 'completed' });
    await expect(
      updatePlan({
        itemId: ITEM_ID,
        planId: plan.id,
        projectId: PROJECT_ID,
        body: { title: 'x' } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
      }),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_ACTIVE', status: 422 });
  });

  it('別 item へ移動し、自分の successor と被参照を解除する (#52)', async () => {
    seedItem({ id: 'item-2' });
    const succ = seedPlan({ id: 'succ' });
    const plan = seedPlan({ id: 'mover', successorPlanId: succ.id });
    const predecessor = seedPlan({ id: 'pred', successorPlanId: 'mover' });
    const dto = await updatePlan({
      itemId: ITEM_ID,
      planId: plan.id,
      projectId: PROJECT_ID,
      body: { itemId: 'item-2' } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
    });
    expect(dto.itemId).toBe('item-2');
    expect(dto.successorPlanId).toBeNull();
    // 自分を指していた先行予定の紐付けも解除
    expect(planStore.find((p) => p.id === 'pred')?.successorPlanId).toBeNull();
    expect(predecessor).toBeDefined();
  });

  it('移動先 item がプロジェクトに無ければ 422 INVALID_ITEM', async () => {
    const plan = seedPlan({ id: 'mover' });
    await expect(
      updatePlan({
        itemId: ITEM_ID,
        planId: plan.id,
        projectId: PROJECT_ID,
        body: { itemId: 'ghost-item' } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ITEM', status: 422 });
  });

  it('移動時は successorPlanId 指定を無視する', async () => {
    seedItem({ id: 'item-2' });
    const other = seedPlan({ id: 'other' });
    const plan = seedPlan({ id: 'mover', successorPlanId: 'old' });
    const dto = await updatePlan({
      itemId: ITEM_ID,
      planId: plan.id,
      projectId: PROJECT_ID,
      body: { itemId: 'item-2', successorPlanId: other.id } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
    });
    expect(dto.itemId).toBe('item-2');
    expect(dto.successorPlanId).toBeNull();
  });

  it('in_progress 状態なら実施者/承認者を変更できる', async () => {
    const exec = seedMember();
    const approver = seedMember();
    const plan = seedPlan({ executorMemberId: exec.id, approverMemberId: approver.id });
    const newExec = seedMember();
    const dto = await updatePlan({
      itemId: ITEM_ID,
      planId: plan.id,
      projectId: PROJECT_ID,
      body: { executorMemberId: newExec.id } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
    });
    expect(dto.executor?.id).toBe(newExec.id);
  });

  it('sent_back 後でも実施者/承認者を変更できる', async () => {
    const exec = seedMember();
    const approver = seedMember();
    const plan = seedPlan({ executorMemberId: exec.id, approverMemberId: approver.id });
    seedBallEvent({ planId: plan.id, eventType: 'review_requested', occurredAt: new Date('2026-06-05T00:00:00Z') });
    seedBallEvent({ planId: plan.id, eventType: 'sent_back', occurredAt: new Date('2026-06-06T00:00:00Z') });
    const newApprover = seedMember();
    const dto = await updatePlan({
      itemId: ITEM_ID,
      planId: plan.id,
      projectId: PROJECT_ID,
      body: { approverMemberId: newApprover.id } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
    });
    expect(dto.approver?.id).toBe(newApprover.id);
  });

  it('確認依頼後は実施者/承認者を変更できず 422 ROLES_LOCKED', async () => {
    const exec = seedMember();
    const approver = seedMember();
    const plan = seedPlan({ executorMemberId: exec.id, approverMemberId: approver.id });
    seedBallEvent({ planId: plan.id, eventType: 'review_requested' });
    const newExec = seedMember();
    await expect(
      updatePlan({
        itemId: ITEM_ID,
        planId: plan.id,
        projectId: PROJECT_ID,
        body: { executorMemberId: newExec.id } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
      }),
    ).rejects.toMatchObject({ code: 'ROLES_LOCKED', status: 422 });
  });

  it('TOSS 前なら進行責任者を変更できる', async () => {
    const exec = seedMember();
    const pm = seedMember();
    const plan = seedPlan({ executorMemberId: exec.id, progressManagerMemberId: pm.id });
    seedBallEvent({ planId: plan.id, eventType: 'approved' });
    const newPm = seedMember();
    const dto = await updatePlan({
      itemId: ITEM_ID,
      planId: plan.id,
      projectId: PROJECT_ID,
      body: { progressManagerMemberId: newPm.id } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
    });
    expect(dto.progressManager?.id).toBe(newPm.id);
  });

  it('TOSS 済みは進行責任者を変更できず 422 ROLES_LOCKED', async () => {
    const pm = seedMember();
    const plan = seedPlan({ progressManagerMemberId: pm.id, fromMemberId: pm.id, toMemberId: 'x' });
    seedBallEvent({ planId: plan.id, eventType: 'tossed' });
    const newPm = seedMember();
    await expect(
      updatePlan({
        itemId: ITEM_ID,
        planId: plan.id,
        projectId: PROJECT_ID,
        body: { progressManagerMemberId: newPm.id } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
      }),
    ).rejects.toMatchObject({ code: 'ROLES_LOCKED', status: 422 });
  });

  it('変更後の実施者がプロジェクトに無ければ 422 INVALID_MEMBER', async () => {
    const exec = seedMember();
    const plan = seedPlan({ executorMemberId: exec.id });
    await expect(
      updatePlan({
        itemId: ITEM_ID,
        planId: plan.id,
        projectId: PROJECT_ID,
        body: { executorMemberId: 'ghost' } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MEMBER', status: 422 });
  });

  it('successorPlanId を null に解除できる', async () => {
    const plan = seedPlan({ successorPlanId: 'old' });
    const dto = await updatePlan({
      itemId: ITEM_ID,
      planId: plan.id,
      projectId: PROJECT_ID,
      body: { successorPlanId: null } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
    });
    expect(dto.successorPlanId).toBeNull();
  });

  it('自分自身を successor にすると 422 SELF_SUCCESSOR', async () => {
    const plan = seedPlan({ id: 'selfp' });
    await expect(
      updatePlan({
        itemId: ITEM_ID,
        planId: plan.id,
        projectId: PROJECT_ID,
        body: { successorPlanId: 'selfp' } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
      }),
    ).rejects.toMatchObject({ code: 'SELF_SUCCESSOR', status: 422 });
  });

  it('有効な successor を設定できる', async () => {
    const succ = seedPlan({ id: 'succ' });
    const plan = seedPlan({ id: 'mainp' });
    const dto = await updatePlan({
      itemId: ITEM_ID,
      planId: plan.id,
      projectId: PROJECT_ID,
      body: { successorPlanId: succ.id } satisfies Parameters<typeof UpdatePlanType>[0]['body'],
    });
    expect(dto.successorPlanId).toBe('succ');
  });
});

// =============================================================================
// setPlanSuccessor
// =============================================================================

describe('setPlanSuccessor', () => {
  it('存在しなければ 404 NOT_FOUND', async () => {
    await expect(
      setPlanSuccessor({ itemId: ITEM_ID, planId: 'nope', body: { successorPlanId: null } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('null 指定で解除する', async () => {
    const plan = seedPlan({ successorPlanId: 'old' });
    const dto = await setPlanSuccessor({
      itemId: ITEM_ID,
      planId: plan.id,
      body: { successorPlanId: null },
    });
    expect(dto.successorPlanId).toBeNull();
  });

  it('自分自身を指すと 422 SELF_SUCCESSOR', async () => {
    const plan = seedPlan({ id: 'selfp' });
    await expect(
      setPlanSuccessor({ itemId: ITEM_ID, planId: plan.id, body: { successorPlanId: 'selfp' } }),
    ).rejects.toMatchObject({ code: 'SELF_SUCCESSOR', status: 422 });
  });

  it('スコープ外 successor は 422 SUCCESSOR_OUT_OF_SCOPE', async () => {
    const plan = seedPlan({ id: 'mainp' });
    await expect(
      setPlanSuccessor({ itemId: ITEM_ID, planId: plan.id, body: { successorPlanId: 'ghost' } }),
    ).rejects.toMatchObject({ code: 'SUCCESSOR_OUT_OF_SCOPE', status: 422 });
  });

  it('既に使われている successor は 422 SUCCESSOR_ALREADY_USED', async () => {
    const succ = seedPlan({ id: 'succ' });
    seedPlan({ id: 'occupier', successorPlanId: succ.id });
    const plan = seedPlan({ id: 'mainp' });
    await expect(
      setPlanSuccessor({ itemId: ITEM_ID, planId: plan.id, body: { successorPlanId: succ.id } }),
    ).rejects.toMatchObject({ code: 'SUCCESSOR_ALREADY_USED', status: 422 });
  });

  it('有効な successor を設定できる', async () => {
    const succ = seedPlan({ id: 'succ' });
    const plan = seedPlan({ id: 'mainp' });
    const dto = await setPlanSuccessor({
      itemId: ITEM_ID,
      planId: plan.id,
      body: { successorPlanId: succ.id },
    });
    expect(dto.successorPlanId).toBe('succ');
  });
});

// =============================================================================
// deletePlan
// =============================================================================

describe('deletePlan', () => {
  it('存在しなければ 404 NOT_FOUND', async () => {
    await expect(deletePlan({ itemId: ITEM_ID, planId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('ball_events が付いていれば 409 PLAN_HAS_EVENTS', async () => {
    const plan = seedPlan();
    seedBallEvent({ planId: plan.id, eventType: 'tossed' });
    await expect(deletePlan({ itemId: ITEM_ID, planId: plan.id })).rejects.toMatchObject({
      code: 'PLAN_HAS_EVENTS',
      status: 409,
    });
  });

  it('events なしの予定は削除でき、被参照は SET NULL される', async () => {
    const plan = seedPlan({ id: 'target' });
    seedPlan({ id: 'pred', successorPlanId: 'target' });
    await deletePlan({ itemId: ITEM_ID, planId: plan.id });
    expect(planStore.find((p) => p.id === 'target')).toBeUndefined();
    expect(planStore.find((p) => p.id === 'pred')?.successorPlanId).toBeNull();
  });
});
