import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  tossPlan as TossPlanType,
  completePlan as CompletePlanType,
  undoTossPlan as UndoTossPlanType,
  undoCompletePlan as UndoCompletePlanType,
} from './ballActions.js';

// =============================================================================
// In-memory Prisma mock
//   ballActions.ts が実際に呼ぶメソッドだけを実装する:
//   - $transaction(callback) (コールバック形式のみ使用)
//   - tx.plan.findFirst (PLAN_INCLUDE / select)
//   - tx.plan.update
//   - tx.ballEvent.create
//   - tx.projectMember.findFirst (select)
//   - tx.auditLog.create
//   deriveBallHolder / pickLatestBallEvent は本物を使う (pure なのでモックしない)。
// =============================================================================

type MockMember = {
  id: string;
  name: string;
  organizationName: string;
  memberType: string;
  projectId: string;
  deletedAt: Date | null;
};

type MockBallEvent = {
  id: string;
  planId: string;
  eventType: 'tossed' | 'completed' | 'toss_undone' | 'completion_undone';
  source: 'human' | 'auto_chain';
  actorMemberId: string | null;
  actorUserId: string | null;
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
  fromMemberId: string | null;
  toMemberId: string | null;
  successorPlanId: string | null;
  status: 'active' | 'completed' | 'canceled';
  memo: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type MockAudit = {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
};

const planStore: Record<string, MockPlan> = {};
const memberStore: Record<string, MockMember> = {};
const ballEventStore: MockBallEvent[] = [];
const auditStore: MockAudit[] = [];

let nextId = 1;
let clock = 0;
const newId = (prefix: string) => `${prefix}-${nextId++}`;
// occurredAt が単調増加するようにし、最新イベント判定を決定的にする
const nextOccurredAt = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++));

// PLAN_INCLUDE を再現: fromMember / toMember を解決し、ballEvents を occurredAt DESC で付与する
function hydratePlan(plan: MockPlan) {
  const ballEvents = ballEventStore
    .filter((e) => e.planId === plan.id)
    .map((e) => ({ ...e, actorMember: e.actorMemberId ? memberStore[e.actorMemberId] ?? null : null }))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  return {
    ...plan,
    fromMember: plan.fromMemberId ? memberStore[plan.fromMemberId] ?? null : null,
    toMember: plan.toMemberId ? memberStore[plan.toMemberId] ?? null : null,
    ballEvents,
  };
}

type FindFirstArgs = {
  where: {
    id?: string;
    itemId?: string;
    projectId?: string;
    deletedAt?: null;
  };
  include?: unknown;
  select?: unknown;
};

const txClient = {
  plan: {
    findFirst: vi.fn(async ({ where }: FindFirstArgs) => {
      const plan = Object.values(planStore).find(
        (p) =>
          (where.id === undefined || p.id === where.id) &&
          (where.itemId === undefined || p.itemId === where.itemId) &&
          (where.deletedAt === undefined || p.deletedAt === where.deletedAt),
      );
      if (!plan) return null;
      return hydratePlan(plan);
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MockPlan> }) => {
      const plan = planStore[where.id]!;
      Object.assign(plan, data, { updatedAt: nextOccurredAt() });
      return plan;
    }),
  },
  ballEvent: {
    create: vi.fn(async ({ data }: { data: Omit<MockBallEvent, 'id' | 'occurredAt' | 'note'> }) => {
      const ev: MockBallEvent = {
        id: newId('be'),
        occurredAt: nextOccurredAt(),
        note: null,
        ...data,
      };
      ballEventStore.push(ev);
      return ev;
    }),
  },
  projectMember: {
    findFirst: vi.fn(async ({ where }: FindFirstArgs) => {
      const m = Object.values(memberStore).find(
        (mem) =>
          (where.id === undefined || mem.id === where.id) &&
          (where.projectId === undefined || mem.projectId === where.projectId) &&
          (where.deletedAt === undefined || mem.deletedAt === where.deletedAt),
      );
      return m ? { id: m.id } : null;
    }),
  },
  auditLog: {
    create: vi.fn(async ({ data }: { data: Omit<MockAudit, 'id'> }) => {
      const r: MockAudit = { id: newId('a'), ...data };
      auditStore.push(r);
      return r;
    }),
  },
};

const prismaMock = {
  ...txClient,
  // ballActions はコールバック形式のみ使用。配列形式も一応両対応にしておく。
  $transaction: vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: typeof txClient) => Promise<unknown>)(txClient);
  }),
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// =============================================================================
// Helpers (テストデータ生成)
// =============================================================================

function makeMember(overrides: Partial<MockMember> = {}): MockMember {
  const m: MockMember = {
    id: newId('m'),
    name: 'メンバー',
    organizationName: '組織',
    memberType: 'production',
    projectId: 'proj-1',
    deletedAt: null,
    ...overrides,
  };
  memberStore[m.id] = m;
  return m;
}

function makePlan(overrides: Partial<MockPlan> = {}): MockPlan {
  const now = nextOccurredAt();
  const p: MockPlan = {
    id: newId('p'),
    itemId: 'item-1',
    planType: 'toss',
    title: 'プラン',
    category: 'design',
    scheduledDate: new Date('2026-05-01T00:00:00Z'),
    dueDate: null,
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
  planStore[p.id] = p;
  return p;
}

function addEvent(
  planId: string,
  eventType: MockBallEvent['eventType'],
  source: MockBallEvent['source'] = 'human',
): MockBallEvent {
  const ev: MockBallEvent = {
    id: newId('be'),
    planId,
    eventType,
    source,
    actorMemberId: null,
    actorUserId: null,
    occurredAt: nextOccurredAt(),
    note: null,
  };
  ballEventStore.push(ev);
  return ev;
}

const eventTypesFor = (planId: string) =>
  ballEventStore.filter((e) => e.planId === planId).map((e) => e.eventType);

// =============================================================================
// Tests
// =============================================================================

let tossPlan: typeof TossPlanType;
let completePlan: typeof CompletePlanType;
let undoTossPlan: typeof UndoTossPlanType;
let undoCompletePlan: typeof UndoCompletePlanType;

beforeAll(async () => {
  ({ tossPlan, completePlan, undoTossPlan, undoCompletePlan } = await import('./ballActions.js'));
});

afterEach(() => {
  for (const k of Object.keys(planStore)) delete planStore[k];
  for (const k of Object.keys(memberStore)) delete memberStore[k];
  ballEventStore.length = 0;
  auditStore.length = 0;
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// tossPlan
// -----------------------------------------------------------------------------
describe('tossPlan', () => {
  it('ready の予定を TOSS すると tossed イベントと監査ログを記録し DTO を返す', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });

    const res = await tossPlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      body: {},
      currentUserId: 'user-1',
      currentMemberId: from.id,
      isDirector: false,
    });

    expect(res.autoTossed).toBeNull();
    expect(res.plan.id).toBe(plan.id);
    expect(res.plan.ballState).toBe('tossed');
    expect(res.plan.ballHolder?.id).toBe(to.id);
    expect(eventTypesFor(plan.id)).toEqual(['tossed']);
    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]).toMatchObject({ action: 'toss', resourceId: plan.id, result: 'success' });
  });

  it('ディレクターはボール保持者でなくても TOSS できる', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });

    const res = await tossPlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      body: {},
      currentUserId: 'user-x',
      currentMemberId: 'someone-else',
      isDirector: true,
    });
    expect(res.plan.ballState).toBe('tossed');
  });

  it('body.toMemberId 指定で TOSS 先を差し替えてから tossed する', async () => {
    const from = makeMember();
    const to = makeMember();
    const newTo = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });

    const res = await tossPlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      body: { toMemberId: newTo.id },
      currentUserId: 'user-1',
      currentMemberId: from.id,
      isDirector: false,
    });
    expect(txClient.plan.update).toHaveBeenCalled();
    expect(res.plan.toMember?.id).toBe(newTo.id);
    expect(res.plan.ballHolder?.id).toBe(newTo.id);
  });

  it('存在しない予定は NOT_FOUND 404', async () => {
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: 'missing',
        body: {},
        currentUserId: 'user-1',
        currentMemberId: 'm',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('active でない予定は PLAN_NOT_ACTIVE 422', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id, status: 'completed' });
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        body: {},
        currentUserId: 'user-1',
        currentMemberId: from.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_ACTIVE', status: 422 });
  });

  it('既に tossed 済みなら ALREADY_TOSSED 409', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });
    addEvent(plan.id, 'tossed');
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        body: {},
        currentUserId: 'user-1',
        currentMemberId: from.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_TOSSED', status: 409 });
  });

  it('FROM/TO 未設定なら INCOMPLETE_PLAN 422', async () => {
    const plan = makePlan({ fromMemberId: null, toMemberId: null });
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        body: {},
        currentUserId: 'user-1',
        currentMemberId: 'm',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_PLAN', status: 422 });
  });

  it('ボール保持者でもディレクターでもなければ FORBIDDEN 403', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        body: {},
        currentUserId: 'user-1',
        currentMemberId: 'stranger',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('body.toMemberId がプロジェクト外なら INVALID_TO_MEMBER 422', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        body: { toMemberId: 'not-a-member' },
        currentUserId: 'user-1',
        currentMemberId: from.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TO_MEMBER', status: 422 });
  });

  it('body.toMemberId が現ボール保持者(FROM)と同一なら INVALID_TO_MEMBER 422', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        body: { toMemberId: from.id },
        currentUserId: 'user-1',
        currentMemberId: from.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TO_MEMBER', status: 422 });
  });
});

// -----------------------------------------------------------------------------
// completePlan
// -----------------------------------------------------------------------------
describe('completePlan', () => {
  it('tossed 済みの予定を完了でき、completed と監査ログを記録する', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });
    addEvent(plan.id, 'tossed');

    const res = await completePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: to.id,
      isDirector: false,
    });
    expect(res.autoTossed).toBeNull();
    expect(res.plan.status).toBe('completed');
    expect(res.plan.ballState).toBe('completed');
    expect(planStore[plan.id]!.status).toBe('completed');
    expect(planStore[plan.id]!.completedAt).toBeInstanceOf(Date);
    expect(eventTypesFor(plan.id)).toEqual(['tossed', 'completed']);
    expect(auditStore.some((a) => a.action === 'complete')).toBe(true);
  });

  it('後続が ready のとき auto_chain で TOSS される (autoTossed を返す)', async () => {
    const from = makeMember();
    const to = makeMember();
    const sFrom = makeMember();
    const sTo = makeMember();
    const successor = makePlan({ fromMemberId: sFrom.id, toMemberId: sTo.id });
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id, successorPlanId: successor.id });
    addEvent(plan.id, 'tossed');

    const res = await completePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: to.id,
      isDirector: false,
    });
    expect(res.autoTossed).not.toBeNull();
    expect(res.autoTossed?.id).toBe(successor.id);
    expect(res.autoTossed?.ballState).toBe('tossed');
    const autoEvents = ballEventStore.filter((e) => e.planId === successor.id);
    expect(autoEvents).toHaveLength(1);
    expect(autoEvents[0]!.source).toBe('auto_chain');
    expect(auditStore.some((a) => a.action === 'auto_toss' && a.resourceId === successor.id)).toBe(true);
  });

  it('後続が既に tossed (ready でない) なら auto_chain しない', async () => {
    const from = makeMember();
    const to = makeMember();
    const successor = makePlan({ fromMemberId: makeMember().id, toMemberId: makeMember().id });
    addEvent(successor.id, 'tossed');
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id, successorPlanId: successor.id });
    addEvent(plan.id, 'tossed');

    const res = await completePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: to.id,
      isDirector: false,
    });
    expect(res.autoTossed).toBeNull();
    // 既存 tossed のみ。auto_chain は追記されない。
    expect(ballEventStore.filter((e) => e.planId === successor.id)).toHaveLength(1);
  });

  it('後続が見つからない (削除済み) 場合は auto_chain しない', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({
      fromMemberId: from.id,
      toMemberId: to.id,
      successorPlanId: 'ghost-successor',
    });
    addEvent(plan.id, 'tossed');

    const res = await completePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: to.id,
      isDirector: false,
    });
    expect(res.autoTossed).toBeNull();
  });

  it('ディレクターはボール保持者でなくても完了できる', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });
    addEvent(plan.id, 'tossed');

    const res = await completePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'dir',
      currentMemberId: 'other',
      isDirector: true,
    });
    expect(res.plan.status).toBe('completed');
  });

  it('存在しない予定は NOT_FOUND 404', async () => {
    await expect(
      completePlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: 'missing',
        currentUserId: 'user-1',
        currentMemberId: 'm',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('active でない予定は PLAN_NOT_ACTIVE 422', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id, status: 'canceled' });
    await expect(
      completePlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: to.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_ACTIVE', status: 422 });
  });

  it('ボール保持者でもディレクターでもなければ FORBIDDEN 403', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });
    addEvent(plan.id, 'tossed');
    await expect(
      completePlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'stranger',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});

// -----------------------------------------------------------------------------
// undoTossPlan
// -----------------------------------------------------------------------------
describe('undoTossPlan', () => {
  it('tossed を差し戻して ready に戻す (toss_undone 追記 + 監査)', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });
    addEvent(plan.id, 'tossed');

    const res = await undoTossPlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: to.id,
    });
    expect(res.plan.ballState).toBe('ready');
    expect(res.plan.ballHolder?.id).toBe(from.id);
    expect(eventTypesFor(plan.id)).toEqual(['tossed', 'toss_undone']);
    expect(auditStore.some((a) => a.action === 'untoss')).toBe(true);
  });

  it('存在しない予定は NOT_FOUND 404', async () => {
    await expect(
      undoTossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: 'missing',
        currentUserId: 'user-1',
        currentMemberId: 'm',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('active でない予定は PLAN_NOT_ACTIVE 422', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id, status: 'completed' });
    addEvent(plan.id, 'tossed');
    await expect(
      undoTossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: to.id,
      }),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_ACTIVE', status: 422 });
  });

  it('tossed 状態でなければ NOT_TOSSED 409', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id });
    // イベント無し = ready
    await expect(
      undoTossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: from.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_TOSSED', status: 409 });
  });
});

// -----------------------------------------------------------------------------
// undoCompletePlan
// -----------------------------------------------------------------------------
describe('undoCompletePlan', () => {
  it('completed を差し戻して tossed (active) に戻す', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id, status: 'completed' });
    addEvent(plan.id, 'tossed');
    addEvent(plan.id, 'completed');

    const res = await undoCompletePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: to.id,
      isDirector: false,
    });
    expect(res.plan.status).toBe('active');
    expect(res.plan.ballState).toBe('tossed');
    expect(planStore[plan.id]!.status).toBe('active');
    expect(planStore[plan.id]!.completedAt).toBeNull();
    expect(eventTypesFor(plan.id)).toEqual(['tossed', 'completed', 'completion_undone']);
    expect(auditStore.some((a) => a.action === 'undo_complete')).toBe(true);
  });

  it('後続が auto_chain で TOSS されていた場合、後続も toss_undone で巻き戻す', async () => {
    const from = makeMember();
    const to = makeMember();
    const successor = makePlan({ fromMemberId: makeMember().id, toMemberId: makeMember().id });
    addEvent(successor.id, 'tossed', 'auto_chain');
    const plan = makePlan({
      fromMemberId: from.id,
      toMemberId: to.id,
      status: 'completed',
      successorPlanId: successor.id,
    });
    addEvent(plan.id, 'tossed');
    addEvent(plan.id, 'completed');

    const res = await undoCompletePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: to.id,
      isDirector: false,
    });
    expect(res.plan.status).toBe('active');
    expect(eventTypesFor(successor.id)).toEqual(['tossed', 'toss_undone']);
    expect(auditStore.some((a) => a.action === 'untoss' && a.resourceId === successor.id)).toBe(true);
  });

  it('後続が auto_chain ではなく既に完了済みなら SUCCESSOR_ALREADY_COMPLETED 409', async () => {
    const from = makeMember();
    const to = makeMember();
    const successor = makePlan({
      fromMemberId: makeMember().id,
      toMemberId: makeMember().id,
      status: 'completed',
    });
    addEvent(successor.id, 'tossed', 'human');
    addEvent(successor.id, 'completed', 'human');
    const plan = makePlan({
      fromMemberId: from.id,
      toMemberId: to.id,
      status: 'completed',
      successorPlanId: successor.id,
    });
    addEvent(plan.id, 'tossed');
    addEvent(plan.id, 'completed');

    await expect(
      undoCompletePlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: to.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'SUCCESSOR_ALREADY_COMPLETED', status: 409 });
  });

  it('後続が auto_chain でなく完了もしていなければ後続には触れず本体のみ巻き戻す', async () => {
    const from = makeMember();
    const to = makeMember();
    const successor = makePlan({ fromMemberId: makeMember().id, toMemberId: makeMember().id });
    addEvent(successor.id, 'tossed', 'human'); // 人手 TOSS (auto_chain ではない)
    const plan = makePlan({
      fromMemberId: from.id,
      toMemberId: to.id,
      status: 'completed',
      successorPlanId: successor.id,
    });
    addEvent(plan.id, 'tossed');
    addEvent(plan.id, 'completed');

    const res = await undoCompletePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: to.id,
      isDirector: false,
    });
    expect(res.plan.status).toBe('active');
    // 後続は変更されない
    expect(eventTypesFor(successor.id)).toEqual(['tossed']);
  });

  it('後続が削除済み (見つからない) でも本体のみ巻き戻す', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({
      fromMemberId: from.id,
      toMemberId: to.id,
      status: 'completed',
      successorPlanId: 'ghost',
    });
    addEvent(plan.id, 'tossed');
    addEvent(plan.id, 'completed');

    const res = await undoCompletePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: to.id,
      isDirector: false,
    });
    expect(res.plan.status).toBe('active');
  });

  it('ディレクターはボール保持者でなくても差し戻せる', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id, status: 'completed' });
    addEvent(plan.id, 'tossed');
    addEvent(plan.id, 'completed');

    const res = await undoCompletePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'dir',
      currentMemberId: 'other',
      isDirector: true,
    });
    expect(res.plan.status).toBe('active');
  });

  it('completed でない予定は PLAN_NOT_COMPLETED 422', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id, status: 'active' });
    addEvent(plan.id, 'tossed');
    await expect(
      undoCompletePlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: to.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_COMPLETED', status: 422 });
  });

  it('ボール保持者でもディレクターでもなければ FORBIDDEN 403', async () => {
    const from = makeMember();
    const to = makeMember();
    const plan = makePlan({ fromMemberId: from.id, toMemberId: to.id, status: 'completed' });
    addEvent(plan.id, 'tossed');
    addEvent(plan.id, 'completed');
    await expect(
      undoCompletePlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'stranger',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('存在しない予定は NOT_FOUND 404', async () => {
    await expect(
      undoCompletePlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: 'missing',
        currentUserId: 'user-1',
        currentMemberId: 'm',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
