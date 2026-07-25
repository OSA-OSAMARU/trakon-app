import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  approvePlan as ApprovePlanType,
  completePlan as CompletePlanType,
  requestReviewPlan as RequestReviewPlanType,
  sendBackPlan as SendBackPlanType,
  sendBackToPredecessorPlan as SendBackToPredecessorPlanType,
  tossPlan as TossPlanType,
  undoApprovePlan as UndoApprovePlanType,
  undoCompletePlan as UndoCompletePlanType,
  undoRequestReviewPlan as UndoRequestReviewPlanType,
  undoTossPlan as UndoTossPlanType,
} from './ballActions.js';

// =============================================================================
// In-memory Prisma mock
//   ballActions.ts (#131) が実際に呼ぶメソッドだけを実装する:
//   - $transaction(callback) (コールバック形式のみ使用)
//   - tx.plan.findFirst (PLAN_INCLUDE / select)
//   - tx.plan.update
//   - tx.ballEvent.create
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

type EventType =
  | 'review_requested'
  | 'approved'
  | 'sent_back'
  | 'review_request_undone'
  | 'approval_undone'
  | 'tossed'
  | 'completed'
  | 'toss_undone'
  | 'completion_undone';

type MockBallEvent = {
  id: string;
  planId: string;
  eventType: EventType;
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
  // 役割 (#131)
  executorMemberId: string | null;
  approverMemberId: string | null;
  progressManagerMemberId: string | null;
  // TOSS 履歴スナップショット
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

const findMember = (id: string | null) => (id ? (memberStore[id] ?? null) : null);

// PLAN_INCLUDE を再現: 役割 + FROM/TO を解決し、ballEvents を occurredAt DESC で付与する
function hydratePlan(plan: MockPlan) {
  const ballEvents = ballEventStore
    .filter((e) => e.planId === plan.id)
    .map((e) => ({ ...e, actorMember: findMember(e.actorMemberId) }))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  return {
    ...plan,
    executor: findMember(plan.executorMemberId),
    approver: findMember(plan.approverMemberId),
    progressManager: findMember(plan.progressManagerMemberId),
    fromMember: findMember(plan.fromMemberId),
    toMember: findMember(plan.toMemberId),
    ballEvents,
  };
}

type FindFirstArgs = {
  where: {
    id?: string;
    itemId?: string;
    projectId?: string;
    successorPlanId?: string;
    deletedAt?: null;
  };
  include?: unknown;
  select?: unknown;
};

const txClient = {
  plan: {
    // select 指定でも生 plan (+ hydrate) を返す。ballActions が読むのは
    // .executorMemberId (toss の successor) と .status/.ballEvents (undoToss の successor)、
    // sendBackToPredecessor は successorPlanId で先行予定を引く。
    findFirst: vi.fn(async ({ where }: FindFirstArgs) => {
      const plan = Object.values(planStore).find(
        (p) =>
          (where.id === undefined || p.id === where.id) &&
          (where.itemId === undefined || p.itemId === where.itemId) &&
          (where.successorPlanId === undefined || p.successorPlanId === where.successorPlanId) &&
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
    create: vi.fn(async ({ data }: { data: Omit<MockBallEvent, 'id' | 'occurredAt' | 'note'> & { note?: string | null } }) => {
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
  planStore[p.id] = p;
  return p;
}

function addEvent(
  planId: string,
  eventType: EventType,
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
  ballEventStore
    .filter((e) => e.planId === planId)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((e) => e.eventType);

/** 実施者/承認者/進行責任者をまとめて用意する。 */
function makeRoles() {
  return {
    executor: makeMember({ name: '実施者' }),
    approver: makeMember({ name: '承認者' }),
    pm: makeMember({ name: '進行責任者' }),
  };
}

// =============================================================================
// Tests
// =============================================================================

let requestReviewPlan: typeof RequestReviewPlanType;
let undoRequestReviewPlan: typeof UndoRequestReviewPlanType;
let approvePlan: typeof ApprovePlanType;
let undoApprovePlan: typeof UndoApprovePlanType;
let sendBackPlan: typeof SendBackPlanType;
let sendBackToPredecessorPlan: typeof SendBackToPredecessorPlanType;
let tossPlan: typeof TossPlanType;
let undoTossPlan: typeof UndoTossPlanType;
let completePlan: typeof CompletePlanType;
let undoCompletePlan: typeof UndoCompletePlanType;

beforeAll(async () => {
  ({
    requestReviewPlan,
    undoRequestReviewPlan,
    approvePlan,
    undoApprovePlan,
    sendBackPlan,
    sendBackToPredecessorPlan,
    tossPlan,
    undoTossPlan,
    completePlan,
    undoCompletePlan,
  } = await import('./ballActions.js'));
});

afterEach(() => {
  for (const k of Object.keys(planStore)) delete planStore[k];
  for (const k of Object.keys(memberStore)) delete memberStore[k];
  ballEventStore.length = 0;
  auditStore.length = 0;
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// requestReviewPlan (実施中/差し戻し → 確認待ち)
// -----------------------------------------------------------------------------
describe('requestReviewPlan', () => {
  it('実施中の予定を確認依頼すると review_requested と監査を記録し確認待ちになる', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });

    const res = await requestReviewPlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: executor.id,
      isDirector: false,
    });

    expect(res.plan.ballState).toBe('review_pending');
    expect(res.plan.ballHolder?.id).toBe(approver.id);
    expect(eventTypesFor(plan.id)).toEqual(['review_requested']);
    expect(auditStore.some((a) => a.action === 'request_review' && a.resourceId === plan.id)).toBe(true);
  });

  it('差し戻し状態からも確認依頼できる', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    addEvent(plan.id, 'review_requested');
    addEvent(plan.id, 'sent_back');

    const res = await requestReviewPlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: executor.id,
      isDirector: false,
    });
    expect(res.plan.ballState).toBe('review_pending');
  });

  it('ディレクターは実施者でなくても確認依頼できる', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    const res = await requestReviewPlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'dir',
      currentMemberId: 'someone-else',
      isDirector: true,
    });
    expect(res.plan.ballState).toBe('review_pending');
  });

  it('実施者が未設定なら INCOMPLETE_PLAN 422', async () => {
    const approver = makeMember();
    const plan = makePlan({ executorMemberId: null, approverMemberId: approver.id });
    await expect(
      requestReviewPlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'x',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_PLAN', status: 422 });
  });

  it('承認者が未設定なら NO_APPROVER 422', async () => {
    const executor = makeMember();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: null });
    await expect(
      requestReviewPlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: executor.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NO_APPROVER', status: 422 });
  });

  it('確認待ち等の予定は INVALID_STATE 409', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    addEvent(plan.id, 'review_requested');
    await expect(
      requestReviewPlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: approver.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
  });

  it('ボール保持者でもディレクターでもなければ FORBIDDEN 403', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    await expect(
      requestReviewPlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'stranger',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('active でない予定は PLAN_NOT_ACTIVE 422', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id, status: 'completed' });
    await expect(
      requestReviewPlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: executor.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_ACTIVE', status: 422 });
  });

  it('存在しない予定は NOT_FOUND 404', async () => {
    await expect(
      requestReviewPlan({
        itemId: 'item-1',
        planId: 'missing',
        currentUserId: 'user-1',
        currentMemberId: 'm',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

// -----------------------------------------------------------------------------
// undoRequestReviewPlan (確認待ち → 実施中)
// -----------------------------------------------------------------------------
describe('undoRequestReviewPlan', () => {
  it('確認待ちを取り消して実施中へ戻す (review_request_undone + 監査)', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    addEvent(plan.id, 'review_requested');

    const res = await undoRequestReviewPlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: executor.id,
      isDirector: false,
    });
    expect(res.plan.ballState).toBe('in_progress');
    expect(res.plan.ballHolder?.id).toBe(executor.id);
    expect(eventTypesFor(plan.id)).toEqual(['review_requested', 'review_request_undone']);
    expect(auditStore.some((a) => a.action === 'undo_request_review')).toBe(true);
  });

  it('承認者も取り消せる', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    addEvent(plan.id, 'review_requested');
    const res = await undoRequestReviewPlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: approver.id,
      isDirector: false,
    });
    expect(res.plan.ballState).toBe('in_progress');
  });

  it('確認待ちでなければ INVALID_STATE 409', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    await expect(
      undoRequestReviewPlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: executor.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
  });

  it('実施者・承認者・ディレクター以外は FORBIDDEN 403', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    addEvent(plan.id, 'review_requested');
    await expect(
      undoRequestReviewPlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'stranger',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});

// -----------------------------------------------------------------------------
// approvePlan (確認待ち → 承認済み。承認者なしなら 実施中 → 承認済み)
// -----------------------------------------------------------------------------
describe('approvePlan', () => {
  it('確認待ちを承認すると承認済みになり進行責任者にボールが渡る (後続あり)', async () => {
    const { executor, approver, pm } = makeRoles();
    const successor = makePlan({ executorMemberId: makeMember().id });
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
      successorPlanId: successor.id,
    });
    addEvent(plan.id, 'review_requested');

    const res = await approvePlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: approver.id,
      isDirector: false,
    });
    expect(res.autoTossed).toBeNull();
    expect(res.plan.ballState).toBe('approved');
    expect(res.plan.ballHolder?.id).toBe(pm.id);
    // 後続があるので承認では完了しない。
    expect(res.plan.status).toBe('active');
    expect(planStore[plan.id]!.status).toBe('active');
    expect(eventTypesFor(plan.id)).toEqual(['review_requested', 'approved']);
    expect(auditStore.some((a) => a.action === 'approve')).toBe(true);
  });

  it('後続が無い予定は承認で完了扱い (status=completed) になる', async () => {
    const { executor, approver, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
    });
    addEvent(plan.id, 'review_requested');

    const res = await approvePlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: approver.id,
      isDirector: false,
    });
    expect(res.plan.status).toBe('completed');
    expect(planStore[plan.id]!.status).toBe('completed');
    expect(planStore[plan.id]!.completedAt).toBeInstanceOf(Date);
    // ball 状態自体は approved (最新イベントは approved)。
    expect(res.plan.ballState).toBe('approved');
  });

  it('承認者なしの予定は実施中から直接承認できる', async () => {
    const { executor, pm } = makeRoles();
    const successor = makePlan({ executorMemberId: makeMember().id });
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: null,
      progressManagerMemberId: pm.id,
      successorPlanId: successor.id,
    });

    const res = await approvePlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: executor.id,
      isDirector: false,
    });
    expect(res.plan.ballState).toBe('approved');
    expect(res.plan.ballHolder?.id).toBe(pm.id);
  });

  it('承認者なしで実施者も未設定なら INCOMPLETE_PLAN 422', async () => {
    const plan = makePlan({ executorMemberId: null, approverMemberId: null });
    await expect(
      approvePlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'x',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_PLAN', status: 422 });
  });

  it('承認者ありで確認待ちでなければ INVALID_STATE 409', async () => {
    const { executor, approver, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
    });
    // 実施中のまま承認しようとする
    await expect(
      approvePlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: approver.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
  });

  it('ディレクターはボール保持者でなくても承認できる', async () => {
    const { executor, approver, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
      successorPlanId: makePlan({ executorMemberId: makeMember().id }).id,
    });
    addEvent(plan.id, 'review_requested');
    const res = await approvePlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'dir',
      currentMemberId: 'other',
      isDirector: true,
    });
    expect(res.plan.ballState).toBe('approved');
  });

  it('ボール保持者でもディレクターでもなければ FORBIDDEN 403', async () => {
    const { executor, approver, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
    });
    addEvent(plan.id, 'review_requested');
    await expect(
      approvePlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'stranger',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('active でない予定は PLAN_NOT_ACTIVE 422', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id, status: 'canceled' });
    await expect(
      approvePlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: approver.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_ACTIVE', status: 422 });
  });

  it('存在しない予定は NOT_FOUND 404', async () => {
    await expect(
      approvePlan({
        itemId: 'item-1',
        planId: 'missing',
        currentUserId: 'user-1',
        currentMemberId: 'm',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

// -----------------------------------------------------------------------------
// undoApprovePlan (承認済み → 確認待ち/実施中。完了扱いなら active に戻す)
// -----------------------------------------------------------------------------
describe('undoApprovePlan', () => {
  it('承認済み (後続ありで active) を取り消して確認待ちへ戻す', async () => {
    const { executor, approver, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
      successorPlanId: makePlan({ executorMemberId: makeMember().id }).id,
    });
    addEvent(plan.id, 'review_requested');
    addEvent(plan.id, 'approved');

    const res = await undoApprovePlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: approver.id,
      isDirector: false,
    });
    // 承認者ありなので確認待ちへ戻る。
    expect(res.plan.ballState).toBe('review_pending');
    expect(res.plan.ballHolder?.id).toBe(approver.id);
    expect(eventTypesFor(plan.id)).toEqual(['review_requested', 'approved', 'approval_undone']);
    expect(auditStore.some((a) => a.action === 'undo_approve')).toBe(true);
  });

  it('承認=完了 (後続なし completed) を取り消すと active に戻り実施中になる', async () => {
    const { executor, pm } = makeRoles();
    // 承認者なし → approval_undone 後は実施中へ戻る。
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: null,
      progressManagerMemberId: pm.id,
      status: 'completed',
      completedAt: new Date(),
    });
    addEvent(plan.id, 'approved');

    const res = await undoApprovePlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: pm.id,
      isDirector: false,
    });
    expect(res.plan.status).toBe('active');
    expect(planStore[plan.id]!.status).toBe('active');
    expect(planStore[plan.id]!.completedAt).toBeNull();
    expect(res.plan.ballState).toBe('in_progress');
    expect(res.plan.ballHolder?.id).toBe(executor.id);
  });

  it('進行責任者も取り消せる', async () => {
    const { executor, approver, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
      successorPlanId: makePlan({ executorMemberId: makeMember().id }).id,
    });
    addEvent(plan.id, 'review_requested');
    addEvent(plan.id, 'approved');
    const res = await undoApprovePlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: pm.id,
      isDirector: false,
    });
    expect(res.plan.ballState).toBe('review_pending');
  });

  it('承認済みでなければ INVALID_STATE 409', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    addEvent(plan.id, 'review_requested');
    await expect(
      undoApprovePlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: approver.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
  });

  it('承認者・進行責任者・ディレクター以外は FORBIDDEN 403', async () => {
    const { executor, approver, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
      successorPlanId: makePlan({ executorMemberId: makeMember().id }).id,
    });
    addEvent(plan.id, 'review_requested');
    addEvent(plan.id, 'approved');
    await expect(
      undoApprovePlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'stranger',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('存在しない予定は NOT_FOUND 404', async () => {
    await expect(
      undoApprovePlan({
        itemId: 'item-1',
        planId: 'missing',
        currentUserId: 'user-1',
        currentMemberId: 'm',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

// -----------------------------------------------------------------------------
// sendBackPlan (確認待ち → 差し戻し)
// -----------------------------------------------------------------------------
describe('sendBackPlan', () => {
  it('確認待ちを差し戻すと実施者にボールが戻り note を保存する', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    addEvent(plan.id, 'review_requested');

    const res = await sendBackPlan({
      itemId: 'item-1',
      planId: plan.id,
      note: '修正してください',
      currentUserId: 'user-1',
      currentMemberId: approver.id,
      isDirector: false,
    });
    expect(res.plan.ballState).toBe('sent_back');
    expect(res.plan.ballHolder?.id).toBe(executor.id);
    expect(eventTypesFor(plan.id)).toEqual(['review_requested', 'sent_back']);
    const sentBack = ballEventStore.find((e) => e.planId === plan.id && e.eventType === 'sent_back');
    expect(sentBack?.note).toBe('修正してください');
    expect(auditStore.some((a) => a.action === 'send_back')).toBe(true);
  });

  it('ディレクターは承認者でなくても差し戻せる', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    addEvent(plan.id, 'review_requested');
    const res = await sendBackPlan({
      itemId: 'item-1',
      planId: plan.id,
      currentUserId: 'dir',
      currentMemberId: 'other',
      isDirector: true,
    });
    expect(res.plan.ballState).toBe('sent_back');
  });

  it('確認待ちでなければ INVALID_STATE 409', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    await expect(
      sendBackPlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: approver.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
  });

  it('ボール保持者 (承認者) でもディレクターでもなければ FORBIDDEN 403', async () => {
    const { executor, approver } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, approverMemberId: approver.id });
    addEvent(plan.id, 'review_requested');
    await expect(
      sendBackPlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'stranger',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('存在しない予定は NOT_FOUND 404', async () => {
    await expect(
      sendBackPlan({
        itemId: 'item-1',
        planId: 'missing',
        currentUserId: 'user-1',
        currentMemberId: 'm',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

// -----------------------------------------------------------------------------
// sendBackToPredecessorPlan (§13 前工程へ差し戻し)
// -----------------------------------------------------------------------------
describe('sendBackToPredecessorPlan', () => {
  /** 先行(デザイン作成) → 後続(デザイン確認) を連結。先行は TOSS 済み(完了)状態にする。 */
  function setupChain() {
    const { executor, approver, pm } = makeRoles();
    const client = makeMember({ name: 'クライアント' });
    const successor = makePlan({
      title: 'デザイン確認',
      executorMemberId: client.id,
      approverMemberId: client.id,
      progressManagerMemberId: pm.id,
    });
    const predecessor = makePlan({
      title: 'デザイン作成',
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
      successorPlanId: successor.id,
      // TOSS 済み(完了)を再現: from=進行責任者/to=後続実施者、status=completed、tossed イベント
      fromMemberId: pm.id,
      toMemberId: client.id,
      status: 'completed',
      completedAt: new Date('2026-05-02T00:00:00Z'),
    });
    addEvent(predecessor.id, 'tossed');
    return { executor, approver, pm, client, successor, predecessor };
  }

  it('後続の実施中から前工程を再開する: 先行に sent_back・status=active・FROM/TO解除、監査は先行に記録', async () => {
    const { executor, client, successor, predecessor } = setupChain();

    const res = await sendBackToPredecessorPlan({
      itemId: 'item-1',
      planId: successor.id,
      note: '色を修正してください',
      currentUserId: 'user-1',
      currentMemberId: client.id, // 後続の実施者=現ボール保持者
      isDirector: false,
    });

    // 先行予定(デザイン作成)が再開: 実施者にボール
    expect(res.predecessor.ballState).toBe('sent_back');
    expect(res.predecessor.ballHolder?.id).toBe(executor.id);
    expect(res.predecessor.status).toBe('active');
    expect(res.predecessor.fromMember).toBeNull();
    expect(res.predecessor.toMember).toBeNull();
    expect(eventTypesFor(predecessor.id)).toEqual(['tossed', 'sent_back']);
    // 差し戻し理由が履歴に引き継がれる
    const sb = ballEventStore.find((e) => e.planId === predecessor.id && e.eventType === 'sent_back');
    expect(sb?.note).toBe('色を修正してください');
    // 後続(デザイン確認)は実施中のまま
    expect(res.plan.ballState).toBe('in_progress');
    // 監査は先行予定に対して記録
    expect(auditStore.some((a) => a.action === 'send_back' && a.resourceId === predecessor.id)).toBe(true);
  });

  it('後続が確認待ちなら確認依頼を取り消して実施中へリセットする', async () => {
    const { client, successor } = setupChain();
    addEvent(successor.id, 'review_requested'); // 後続を確認待ちにする

    const res = await sendBackToPredecessorPlan({
      itemId: 'item-1',
      planId: successor.id,
      currentUserId: 'user-1',
      currentMemberId: client.id, // 確認待ちの holder = approver(=client)
      isDirector: false,
    });
    expect(res.plan.ballState).toBe('in_progress');
    expect(eventTypesFor(successor.id)).toEqual(['review_requested', 'review_request_undone']);
  });

  it('先行予定(前工程)が無ければ NO_PREDECESSOR 422', async () => {
    const { executor } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id });
    await expect(
      sendBackToPredecessorPlan({
        itemId: 'item-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: executor.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NO_PREDECESSOR', status: 422 });
  });

  it('後続が承認済み(TOSS待ち)だと INVALID_STATE 409', async () => {
    const { pm, client, successor } = setupChain();
    addEvent(successor.id, 'approved'); // 承認済みにする
    await expect(
      sendBackToPredecessorPlan({
        itemId: 'item-1',
        planId: successor.id,
        currentUserId: 'user-1',
        currentMemberId: pm.id,
        isDirector: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
    void client;
  });

  it('現ボール保持者でもディレクターでもなければ FORBIDDEN 403', async () => {
    const { successor } = setupChain();
    const stranger = makeMember();
    await expect(
      sendBackToPredecessorPlan({
        itemId: 'item-1',
        planId: successor.id,
        currentUserId: 'user-1',
        currentMemberId: stranger.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});

// -----------------------------------------------------------------------------
// tossPlan (承認済み → TOSS済み)
// -----------------------------------------------------------------------------
describe('tossPlan', () => {
  /** approved 状態の先行予定 + 実施者付き後続予定を用意する。 */
  function setupApproved(overrides: { successorExecutor?: string | null } = {}) {
    const { executor, pm } = makeRoles();
    const successorExecutor =
      overrides.successorExecutor === undefined ? makeMember({ name: '後続実施者' }).id : overrides.successorExecutor;
    const successor = makePlan({ executorMemberId: successorExecutor });
    const plan = makePlan({
      executorMemberId: executor.id,
      progressManagerMemberId: pm.id,
      successorPlanId: successor.id,
    });
    addEvent(plan.id, 'approved');
    return { plan, successor, pm, successorExecutor };
  }

  it('承認済みを TOSS すると FROM/TO 履歴を書き込み後続実施者にボールが渡る', async () => {
    const { plan, pm, successorExecutor } = setupApproved();

    const res = await tossPlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: pm.id,
      isDirector: false,
    });

    expect(res.autoTossed).toBeNull();
    expect(res.plan.ballState).toBe('tossed');
    expect(res.plan.ballHolder?.id).toBe(successorExecutor);
    // FROM=進行責任者 / TO=後続実施者 の履歴。
    expect(res.plan.fromMember?.id).toBe(pm.id);
    expect(res.plan.toMember?.id).toBe(successorExecutor);
    // 先行予定は完了。
    expect(res.plan.status).toBe('completed');
    expect(planStore[plan.id]!.status).toBe('completed');
    expect(planStore[plan.id]!.completedAt).toBeInstanceOf(Date);
    expect(eventTypesFor(plan.id)).toEqual(['approved', 'tossed']);
    expect(auditStore.some((a) => a.action === 'toss')).toBe(true);
  });

  it('ディレクターは進行責任者でなくても TOSS できる', async () => {
    const { plan } = setupApproved();
    const res = await tossPlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'dir',
      currentMemberId: 'other',
      isDirector: true,
    });
    expect(res.plan.ballState).toBe('tossed');
  });

  it('承認済みでなければ NOT_APPROVED 409', async () => {
    const { executor, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      progressManagerMemberId: pm.id,
      successorPlanId: makePlan({ executorMemberId: makeMember().id }).id,
    });
    // イベント無し = 実施中
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: pm.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_APPROVED', status: 409 });
  });

  it('後続が無ければ NO_SUCCESSOR 422', async () => {
    const { executor, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      progressManagerMemberId: pm.id,
      successorPlanId: null,
    });
    addEvent(plan.id, 'approved');
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: pm.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'NO_SUCCESSOR', status: 422 });
  });

  it('進行責任者が未設定なら INCOMPLETE_PLAN 422', async () => {
    const { executor } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      progressManagerMemberId: null,
      successorPlanId: makePlan({ executorMemberId: makeMember().id }).id,
    });
    addEvent(plan.id, 'approved');
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'x',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_PLAN', status: 422 });
  });

  it('後続の実施者が未設定なら SUCCESSOR_NO_EXECUTOR 422', async () => {
    const { plan, pm } = setupApproved({ successorExecutor: null });
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: pm.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'SUCCESSOR_NO_EXECUTOR', status: 422 });
  });

  it('ボール保持者 (進行責任者) でもディレクターでもなければ FORBIDDEN 403', async () => {
    const { plan } = setupApproved();
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'stranger',
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('active でない予定は PLAN_NOT_ACTIVE 422', async () => {
    const { executor, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      progressManagerMemberId: pm.id,
      successorPlanId: makePlan({ executorMemberId: makeMember().id }).id,
      status: 'completed',
    });
    addEvent(plan.id, 'approved');
    await expect(
      tossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: pm.id,
        isDirector: false,
      }),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_ACTIVE', status: 422 });
  });

  it('存在しない予定は NOT_FOUND 404', async () => {
    await expect(
      tossPlan({
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

// -----------------------------------------------------------------------------
// undoTossPlan (TOSS済み → 承認済み)
// -----------------------------------------------------------------------------
describe('undoTossPlan', () => {
  /** tossed 済みの先行予定 (status=completed, FROM/TO 履歴あり) を用意する。 */
  function setupTossed(successorStatus: 'active' | 'completed' = 'active') {
    const { executor, pm } = makeRoles();
    const successorExecutor = makeMember().id;
    const successor = makePlan({ executorMemberId: successorExecutor, status: successorStatus });
    const plan = makePlan({
      executorMemberId: executor.id,
      progressManagerMemberId: pm.id,
      successorPlanId: successor.id,
      fromMemberId: pm.id,
      toMemberId: successorExecutor,
      status: 'completed',
      completedAt: new Date(),
    });
    addEvent(plan.id, 'approved');
    addEvent(plan.id, 'tossed');
    return { plan, successor, pm };
  }

  it('TOSS を取り消して承認済みへ戻す (approved 再追記 + FROM/TO クリア + 監査)', async () => {
    const { plan, pm } = setupTossed();

    const res = await undoTossPlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: pm.id,
    });
    expect(res.plan.ballState).toBe('approved');
    expect(res.plan.ballHolder?.id).toBe(pm.id);
    expect(res.plan.status).toBe('active');
    expect(planStore[plan.id]!.status).toBe('active');
    expect(planStore[plan.id]!.fromMemberId).toBeNull();
    expect(planStore[plan.id]!.toMemberId).toBeNull();
    expect(eventTypesFor(plan.id)).toEqual(['approved', 'tossed', 'approved']);
    expect(auditStore.some((a) => a.action === 'untoss')).toBe(true);
  });

  it('プロジェクトメンバーなら誰でも取り消せる (#50)', async () => {
    const { plan } = setupTossed();
    const res = await undoTossPlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: 'anyone',
    });
    expect(res.plan.ballState).toBe('approved');
  });

  it('後続が完了済みなら SUCCESSOR_ALREADY_COMPLETED 409', async () => {
    const { plan } = setupTossed('completed');
    await expect(
      undoTossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: 'anyone',
      }),
    ).rejects.toMatchObject({ code: 'SUCCESSOR_ALREADY_COMPLETED', status: 409 });
  });

  it('TOSS 済みでなければ NOT_TOSSED 409', async () => {
    const { executor, pm } = makeRoles();
    const plan = makePlan({ executorMemberId: executor.id, progressManagerMemberId: pm.id });
    addEvent(plan.id, 'approved'); // 承認済み (tossed ではない)
    await expect(
      undoTossPlan({
        itemId: 'item-1',
        projectId: 'proj-1',
        planId: plan.id,
        currentUserId: 'user-1',
        currentMemberId: pm.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_TOSSED', status: 409 });
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
});

// -----------------------------------------------------------------------------
// completePlan / undoCompletePlan (後方互換エイリアス)
// -----------------------------------------------------------------------------
describe('completePlan / undoCompletePlan (エイリアス)', () => {
  it('completePlan は approvePlan として振る舞う (後続なしは完了)', async () => {
    const { executor, approver, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: pm.id,
    });
    addEvent(plan.id, 'review_requested');

    const res = await completePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: approver.id,
      isDirector: false,
    });
    expect(res.plan.status).toBe('completed');
    expect(eventTypesFor(plan.id)).toEqual(['review_requested', 'approved']);
    expect(auditStore.some((a) => a.action === 'approve')).toBe(true);
  });

  it('undoCompletePlan は undoApprovePlan として振る舞う (完了を active に戻す)', async () => {
    const { executor, pm } = makeRoles();
    const plan = makePlan({
      executorMemberId: executor.id,
      approverMemberId: null,
      progressManagerMemberId: pm.id,
      status: 'completed',
      completedAt: new Date(),
    });
    addEvent(plan.id, 'approved');

    const res = await undoCompletePlan({
      itemId: 'item-1',
      projectId: 'proj-1',
      planId: plan.id,
      currentUserId: 'user-1',
      currentMemberId: pm.id,
      isDirector: false,
    });
    expect(res.plan.status).toBe('active');
    expect(eventTypesFor(plan.id)).toEqual(['approved', 'approval_undone']);
    expect(auditStore.some((a) => a.action === 'undo_approve')).toBe(true);
  });
});
