import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { hashToken } from '../lib/tokens.js';
import type {
  viewShare as ViewShareType,
  shareRequestReview as ShareRequestReviewType,
  shareApprove as ShareApproveType,
  shareSendBack as ShareSendBackType,
} from './shareAccess.js';

// =============================================================================
// Mocks
// =============================================================================
// 実体は in-memory store。prisma は shareAccess.ts / shareLinks.ts が呼ぶメソッドのみ実装する。
// hashToken は純粋関数 (SHA-256) なのでモックせず実物を使い、tokenHash でストアを引く。

type MockMember = {
  id: string;
  name: string;
  organizationName: string;
  memberType: string;
};
type MockBallEvent = {
  id: string;
  planId: string;
  eventType: string;
  source: string;
  actorMemberId: string | null;
  actorUserId: string | null;
  actorMember: MockMember | null;
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
  executorMemberId: string | null;
  approverMemberId: string | null;
  progressManagerMemberId: string | null;
  executor: MockMember | null;
  approver: MockMember | null;
  progressManager: MockMember | null;
  fromMemberId: string | null;
  toMemberId: string | null;
  fromMember: MockMember | null;
  toMember: MockMember | null;
  successorPlanId: string | null;
  status: string;
  memo: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  ballEvents: MockBallEvent[];
};
type MockItem = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  deletedAt: Date | null;
};
type MockProject = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  deletedAt: Date | null;
};
type MockShareLink = {
  id: string;
  projectId: string;
  scopeType: string;
  scopeTargetId: string | null;
  tokenHash: string;
  issuedByMemberId: string;
  issuedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastAccessedAt: Date | null;
};

const shareLinkStore: MockShareLink[] = [];
const projectStore: MockProject[] = [];
const itemStore: MockItem[] = [];
const planStore: MockPlan[] = [];
const ballEventStore: MockBallEvent[] = [];
const auditStore: Array<Record<string, unknown>> = [];

let nextId = 1;
const newId = (p: string) => `${p}-${nextId++}`;

// plan の ballEvents は occurredAt DESC 並びを常に維持して返す (実 prisma の orderBy 相当)。
function ballEventsFor(planId: string): MockBallEvent[] {
  return ballEventStore
    .filter((e) => e.planId === planId)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

// PLAN_INCLUDE 相当の hydrated plan を返すヘルパ。
function hydratePlan(p: MockPlan): MockPlan {
  return { ...p, ballEvents: ballEventsFor(p.id) };
}

// where 句の一部 (id/itemId/successorPlanId/deletedAt) でマッチング。
function matchPlan(p: MockPlan, where: Record<string, unknown>): boolean {
  if (where.id !== undefined && p.id !== where.id) return false;
  if (where.itemId !== undefined) {
    if (typeof where.itemId === 'object' && where.itemId !== null) {
      // scope=project の itemId: { in: [...] } 形式
      const inArr = (where.itemId as { in?: string[] }).in;
      if (inArr && !inArr.includes(p.itemId)) return false;
    } else if (p.itemId !== where.itemId) {
      return false;
    }
  }
  if (where.successorPlanId !== undefined && p.successorPlanId !== where.successorPlanId)
    return false;
  if ('deletedAt' in where && where.deletedAt === null && p.deletedAt !== null) return false;
  return true;
}

const planDelegate = {
  findFirst: vi.fn(async ({ where, include }: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
    const found = planStore.find((p) => matchPlan(p, where));
    if (!found) return null;
    const hydrated = hydratePlan(found);
    // include.item があれば item を組み立てる
    if (include?.item) {
      const item = itemStore.find((it) => it.id === found.itemId);
      return {
        ...hydrated,
        item: item ? { id: item.id, projectId: item.projectId } : null,
      };
    }
    return hydrated;
  }),
  findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return planStore
      .filter((p) => matchPlan(p, where))
      .sort(
        (a, b) =>
          a.scheduledDate.getTime() - b.scheduledDate.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .map(hydratePlan);
  }),
  update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const p = planStore.find((x) => x.id === where.id);
    if (!p) throw new Error('plan not found in update');
    Object.assign(p, data);
    return hydratePlan(p);
  }),
};

const ballEventDelegate = {
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const ev: MockBallEvent = {
      id: newId('be'),
      planId: data.planId as string,
      eventType: data.eventType as string,
      source: data.source as string,
      actorMemberId: (data.actorMemberId as string | null) ?? null,
      actorUserId: (data.actorUserId as string | null) ?? null,
      actorMember: null,
      occurredAt: new Date(Date.now() + nextId), // 単調増加で DESC 安定化
      note: (data.note as string | null) ?? null,
    };
    ballEventStore.push(ev);
    return ev;
  }),
};

const prismaMock = {
  shareLink: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const now = Date.now();
      return (
        shareLinkStore.find((s) => {
          if (s.tokenHash !== where.tokenHash) return false;
          if (s.revokedAt !== null) return false;
          // 無期限 or 未来日のみ有効
          if (s.expiresAt !== null && s.expiresAt.getTime() <= now) return false;
          return true;
        }) ?? null
      );
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const s = shareLinkStore.find((x) => x.id === where.id);
      if (s) Object.assign(s, data);
      return s;
    }),
  },
  project: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const proj = projectStore.find(
        (p) => p.id === where.id && (!('deletedAt' in where) || p.deletedAt === null),
      );
      if (!proj) return null;
      const items = itemStore
        .filter((it) => it.projectId === proj.id && it.deletedAt === null)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return { ...proj, items };
    }),
  },
  plan: planDelegate,
  ballEvent: ballEventDelegate,
  auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      auditStore.push(data);
      return { id: newId('al'), ...data };
    }),
  },
  // shareToss / shareComplete はコールバック形式の $transaction を使う。
  $transaction: vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => Promise<unknown>)({
      plan: planDelegate,
      ballEvent: ballEventDelegate,
      auditLog: prismaMock.auditLog,
    });
  }),
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// =============================================================================
// Fixtures
// =============================================================================

const RAW_TOKEN = 'raw-share-token-abc';
const TOKEN_HASH = hashToken(RAW_TOKEN);

function makeMember(over: Partial<MockMember> = {}): MockMember {
  return {
    id: newId('m'),
    name: 'Member',
    organizationName: 'Org',
    memberType: 'production',
    ...over,
  };
}

function seedProject(): MockProject {
  const proj: MockProject = {
    id: 'proj-1',
    name: 'プロジェクトA',
    startDate: new Date('2026-06-01T00:00:00Z'),
    endDate: new Date('2026-06-30T00:00:00Z'),
    deletedAt: null,
  };
  projectStore.push(proj);
  return proj;
}

function seedItem(over: Partial<MockItem> = {}): MockItem {
  const item: MockItem = {
    id: newId('item'),
    projectId: 'proj-1',
    name: '制作物',
    sortOrder: itemStore.length,
    deletedAt: null,
    ...over,
  };
  itemStore.push(item);
  return item;
}

function seedPlan(over: Partial<MockPlan> = {}): MockPlan {
  const plan: MockPlan = {
    id: newId('plan'),
    itemId: 'item-x',
    planType: 'toss',
    title: '予定',
    category: 'design',
    scheduledDate: new Date('2026-06-10T00:00:00Z'),
    dueDate: null,
    executorMemberId: null,
    approverMemberId: null,
    progressManagerMemberId: null,
    executor: null,
    approver: null,
    progressManager: null,
    fromMemberId: null,
    toMemberId: null,
    fromMember: null,
    toMember: null,
    successorPlanId: null,
    status: 'active',
    memo: null,
    completedAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    deletedAt: null,
    ballEvents: [],
    ...over,
  };
  planStore.push(plan);
  return plan;
}

function seedShareLink(over: Partial<MockShareLink> = {}): MockShareLink {
  const link: MockShareLink = {
    id: newId('sl'),
    projectId: 'proj-1',
    scopeType: 'project',
    scopeTargetId: null,
    tokenHash: TOKEN_HASH,
    issuedByMemberId: 'm-issuer',
    issuedAt: new Date('2026-06-01T00:00:00Z'),
    expiresAt: null,
    revokedAt: null,
    lastAccessedAt: null,
    ...over,
  };
  shareLinkStore.push(link);
  return link;
}

// =============================================================================
// Tests
// =============================================================================

let viewShare: typeof ViewShareType;
let shareRequestReview: typeof ShareRequestReviewType;
let shareApprove: typeof ShareApproveType;
let shareSendBack: typeof ShareSendBackType;

beforeAll(async () => {
  ({ viewShare, shareRequestReview, shareApprove, shareSendBack } = await import('./shareAccess.js'));
});

afterEach(() => {
  shareLinkStore.length = 0;
  projectStore.length = 0;
  itemStore.length = 0;
  planStore.length = 0;
  ballEventStore.length = 0;
  auditStore.length = 0;
  vi.clearAllMocks();
});

describe('viewShare', () => {
  it('project scope: 全 item のプランを返し、last_accessed_at と監査ログを記録する', async () => {
    seedProject();
    const itemA = seedItem({ id: 'item-a', name: 'A', sortOrder: 1 });
    seedItem({ id: 'item-b', name: 'B', sortOrder: 0 }); // sortOrder で B が先
    const from = makeMember({ id: 'mf', name: 'From' });
    const to = makeMember({ id: 'mt', name: 'To' });
    seedPlan({
      id: 'plan-a',
      itemId: itemA.id,
      fromMemberId: from.id,
      toMemberId: to.id,
      fromMember: from,
      toMember: to,
    });
    const link = seedShareLink({ scopeType: 'project' });

    const res = await viewShare({ rawToken: RAW_TOKEN, ip: '1.2.3.4', userAgent: 'jest' });

    expect(res.share).toMatchObject({ id: link.id, scopeType: 'project', scopeTargetId: null, expiresAt: null });
    expect(res.project).toMatchObject({
      id: 'proj-1',
      name: 'プロジェクトA',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    });
    // items は sortOrder 昇順
    expect(res.items.map((i) => i.id)).toEqual(['item-b', 'item-a']);
    expect(res.plans).toHaveLength(1);
    expect(res.plans[0]).toMatchObject({ id: 'plan-a', ballState: 'in_progress' });

    // last_accessed_at 更新 + 監査ログ
    expect(prismaMock.shareLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: link.id } }),
    );
    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]).toMatchObject({
      shareLinkId: link.id,
      action: 'share_access',
      resourceType: 'project',
      resourceId: 'proj-1',
      result: 'success',
      ip: '1.2.3.4',
      userAgent: 'jest',
    });
  });

  it('item scope: 対象 item のみへ絞り込み、expiresAt を ISO で返す', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    seedItem({ id: 'item-b', name: 'B' });
    seedPlan({ id: 'p-a', itemId: 'item-a' });
    seedPlan({ id: 'p-b', itemId: 'item-b' });
    const expires = new Date('2026-12-31T00:00:00.000Z');
    seedShareLink({ scopeType: 'item', scopeTargetId: 'item-a', expiresAt: expires });

    const res = await viewShare({ rawToken: RAW_TOKEN });

    expect(res.items.map((i) => i.id)).toEqual(['item-a']);
    expect(res.plans.map((p) => p.id)).toEqual(['p-a']);
    expect(res.share.expiresAt).toBe(expires.toISOString());
    // ip/userAgent 未指定 → null
    expect(auditStore[0]).toMatchObject({ resourceType: 'item', resourceId: 'item-a', ip: null, userAgent: null });
  });

  it('plan scope: 対象 plan の所属 item だけを items に含める', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    seedItem({ id: 'item-b', name: 'B' });
    seedPlan({ id: 'p-a', itemId: 'item-a' });
    seedPlan({ id: 'p-b', itemId: 'item-b' });
    seedShareLink({ scopeType: 'plan', scopeTargetId: 'p-b' });

    const res = await viewShare({ rawToken: RAW_TOKEN });

    expect(res.items.map((i) => i.id)).toEqual(['item-b']);
    expect(res.plans.map((p) => p.id)).toEqual(['p-b']);
    expect(auditStore[0]).toMatchObject({ resourceType: 'plan', resourceId: 'p-b' });
  });

  it('未存在トークン → 404 SHARE_NOT_FOUND_OR_EXPIRED', async () => {
    seedProject();
    await expect(viewShare({ rawToken: 'nope' })).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });

  it('revoked リンク → 404', async () => {
    seedProject();
    seedShareLink({ revokedAt: new Date('2026-06-05T00:00:00Z') });
    await expect(viewShare({ rawToken: RAW_TOKEN })).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });

  it('期限切れリンク → 404', async () => {
    seedProject();
    seedShareLink({ expiresAt: new Date('2020-01-01T00:00:00Z') });
    await expect(viewShare({ rawToken: RAW_TOKEN })).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });

  it('プロジェクトが削除済み (project 取得不可) → 404', async () => {
    // share link はあるが project は無い
    seedShareLink({ scopeType: 'project' });
    await expect(viewShare({ rawToken: RAW_TOKEN })).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });

  it('item scope の対象 item が存在しない → 404', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    seedShareLink({ scopeType: 'item', scopeTargetId: 'missing-item' });
    await expect(viewShare({ rawToken: RAW_TOKEN })).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });

  it('plan scope の対象 plan が存在しない → 404', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    seedShareLink({ scopeType: 'plan', scopeTargetId: 'missing-plan' });
    await expect(viewShare({ rawToken: RAW_TOKEN })).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });
});

// review_requested イベントを積んで「確認待ち」状態を作る。
function pushEvent(planId: string, eventType: string) {
  ballEventStore.push({
    id: `be-${eventType}-${planId}`,
    planId,
    eventType,
    source: 'human',
    actorMemberId: null,
    actorUserId: null,
    actorMember: null,
    occurredAt: new Date('2026-06-05T00:00:00Z'),
    note: null,
  });
}

describe('shareRequestReview', () => {
  it('承認者あり実施中 → review_requested イベント + 監査 share_request_review', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    const exec = makeMember({ id: 'ex' });
    const appr = makeMember({ id: 'ap' });
    seedPlan({
      id: 'plan-1',
      itemId: 'item-a',
      status: 'active',
      executorMemberId: exec.id,
      executor: exec,
      approverMemberId: appr.id,
      approver: appr,
    });
    const link = seedShareLink({ scopeType: 'project' });

    const res = await shareRequestReview({ rawToken: RAW_TOKEN, planId: 'plan-1', ip: '9.9.9.9' });

    expect(res.plan.ballState).toBe('review_pending');
    const ev = ballEventStore.filter((e) => e.planId === 'plan-1' && e.eventType === 'review_requested');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ source: 'auto_chain', actorMemberId: null, actorUserId: null });
    expect(ev[0]!.note).toContain(link.id);
    expect(auditStore.some((a) => a.action === 'share_request_review' && a.resourceId === 'plan-1')).toBe(true);
  });

  it('承認者なし → 422 NO_APPROVER', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    const exec = makeMember({ id: 'ex' });
    seedPlan({ id: 'plan-1', itemId: 'item-a', status: 'active', executorMemberId: exec.id, executor: exec });
    seedShareLink({ scopeType: 'project' });
    await expect(shareRequestReview({ rawToken: RAW_TOKEN, planId: 'plan-1' })).rejects.toMatchObject({
      code: 'NO_APPROVER',
      status: 422,
    });
  });
});

describe('shareApprove', () => {
  it('承認者なし実施中 → approved イベント。後続なしで completed、監査 share_approve', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    const exec = makeMember({ id: 'ex' });
    seedPlan({ id: 'plan-1', itemId: 'item-a', status: 'active', executorMemberId: exec.id, executor: exec });
    seedShareLink({ scopeType: 'project' });

    const res = await shareApprove({ rawToken: RAW_TOKEN, planId: 'plan-1', userAgent: 'ua' });

    expect(res.plan.ballState).toBe('approved');
    expect(res.plan.status).toBe('completed'); // 後続なし = 承認で完了
    expect(planStore.find((p) => p.id === 'plan-1')?.status).toBe('completed');
    const ev = ballEventStore.filter((e) => e.planId === 'plan-1' && e.eventType === 'approved');
    expect(ev[0]).toMatchObject({ source: 'auto_chain', actorMemberId: null, actorUserId: null });
    expect(auditStore.some((a) => a.action === 'share_approve' && a.resourceId === 'plan-1')).toBe(true);
  });

  it('承認者あり確認待ち → approved (後続ありは active のまま)', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    const exec = makeMember({ id: 'ex' });
    const appr = makeMember({ id: 'ap' });
    const pm = makeMember({ id: 'pm' });
    seedPlan({
      id: 'succ',
      itemId: 'item-a',
      status: 'active',
      executorMemberId: exec.id,
      executor: exec,
    });
    seedPlan({
      id: 'plan-1',
      itemId: 'item-a',
      status: 'active',
      executorMemberId: exec.id,
      executor: exec,
      approverMemberId: appr.id,
      approver: appr,
      progressManagerMemberId: pm.id,
      progressManager: pm,
      successorPlanId: 'succ',
    });
    pushEvent('plan-1', 'review_requested'); // 確認待ちにする
    seedShareLink({ scopeType: 'project' });

    const res = await shareApprove({ rawToken: RAW_TOKEN, planId: 'plan-1' });

    expect(res.plan.ballState).toBe('approved');
    expect(res.plan.status).toBe('active'); // 後続あり = TOSS 待ち
  });

  it('承認者あり実施中(確認依頼前)で承認 → 409 INVALID_STATE', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    const exec = makeMember({ id: 'ex' });
    const appr = makeMember({ id: 'ap' });
    seedPlan({
      id: 'plan-1',
      itemId: 'item-a',
      status: 'active',
      executorMemberId: exec.id,
      executor: exec,
      approverMemberId: appr.id,
      approver: appr,
    });
    seedShareLink({ scopeType: 'project' });
    await expect(shareApprove({ rawToken: RAW_TOKEN, planId: 'plan-1' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    });
  });

  it('plan が active でない → 422 PLAN_NOT_ACTIVE', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    seedPlan({ id: 'plan-1', itemId: 'item-a', status: 'completed' });
    seedShareLink({ scopeType: 'project' });
    await expect(shareApprove({ rawToken: RAW_TOKEN, planId: 'plan-1' })).rejects.toMatchObject({
      code: 'PLAN_NOT_ACTIVE',
      status: 422,
    });
  });

  // scope 検証 (runShareAction 共通)
  it('scope 外 plan (別 project) → 404', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A', projectId: 'other-proj' });
    seedPlan({ id: 'plan-1', itemId: 'item-a' });
    seedShareLink({ scopeType: 'project', projectId: 'proj-1' });
    await expect(shareApprove({ rawToken: RAW_TOKEN, planId: 'plan-1' })).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });

  it('item scope で別 item の plan → 404', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    seedItem({ id: 'item-b', name: 'B' });
    seedPlan({ id: 'plan-1', itemId: 'item-b' });
    seedShareLink({ scopeType: 'item', scopeTargetId: 'item-a' });
    await expect(shareApprove({ rawToken: RAW_TOKEN, planId: 'plan-1' })).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });

  it('存在しない plan → 404', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    seedShareLink({ scopeType: 'project' });
    await expect(shareApprove({ rawToken: RAW_TOKEN, planId: 'ghost' })).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });
});

describe('shareSendBack', () => {
  it('確認待ち → sent_back イベント + 監査 share_send_back', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    const exec = makeMember({ id: 'ex' });
    const appr = makeMember({ id: 'ap' });
    seedPlan({
      id: 'plan-1',
      itemId: 'item-a',
      status: 'active',
      executorMemberId: exec.id,
      executor: exec,
      approverMemberId: appr.id,
      approver: appr,
    });
    pushEvent('plan-1', 'review_requested');
    seedShareLink({ scopeType: 'project' });

    const res = await shareSendBack({ rawToken: RAW_TOKEN, planId: 'plan-1' });

    expect(res.plan.ballState).toBe('sent_back');
    expect(ballEventStore.some((e) => e.planId === 'plan-1' && e.eventType === 'sent_back')).toBe(true);
    expect(auditStore.some((a) => a.action === 'share_send_back' && a.resourceId === 'plan-1')).toBe(true);
  });

  it('確認待ちでない(実施中)で差し戻し → 409 INVALID_STATE', async () => {
    seedProject();
    seedItem({ id: 'item-a', name: 'A' });
    const exec = makeMember({ id: 'ex' });
    seedPlan({ id: 'plan-1', itemId: 'item-a', status: 'active', executorMemberId: exec.id, executor: exec });
    seedShareLink({ scopeType: 'project' });
    await expect(shareSendBack({ rawToken: RAW_TOKEN, planId: 'plan-1' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    });
  });
});
