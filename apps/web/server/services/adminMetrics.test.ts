import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { getPlatformMetrics as GetPlatformMetricsType } from './adminMetrics.js';

// =============================================================================
// 運営向けの集計 (#204)
//
// 見るのは「実効プランで正しく振り分けられるか」。契約プランのまま数えると
// 解約済み・支払い不能の組織が有料として計上され、読み違いの原因になる。
// =============================================================================

type MockOrg = {
  id: string;
  deletedAt: Date | null;
  BillingSubscription: {
    planCode: string;
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
    gracePeriodEndsAt: Date | null;
  } | null;
};

const orgStore: MockOrg[] = [];
const projectStore: { organizationId: string; archivedAt: Date | null; deletedAt: Date | null }[] =
  [];
const orgMemberStore: { organizationId: string; deletedAt: Date | null }[] = [];
let userTotal = 0;
let userNewIn30Days = 0;

const prismaMock = {
  user: {
    count: vi.fn(async ({ where }: { where: { createdAt?: unknown } }) =>
      where.createdAt ? userNewIn30Days : userTotal,
    ),
  },
  organization: {
    findMany: vi.fn(async () => orgStore.filter((o) => o.deletedAt === null)),
  },
  project: {
    findMany: vi.fn(async () => projectStore.filter((p) => p.deletedAt === null)),
  },
  organizationMember: {
    groupBy: vi.fn(async () => {
      const counts = new Map<string, number>();
      for (const m of orgMemberStore) {
        if (m.deletedAt !== null) continue;
        counts.set(m.organizationId, (counts.get(m.organizationId) ?? 0) + 1);
      }
      return [...counts].map(([organizationId, n]) => ({
        organizationId,
        _count: { _all: n },
      }));
    }),
  },
};
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

let getPlatformMetrics: typeof GetPlatformMetricsType;

beforeAll(async () => {
  ({ getPlatformMetrics } = await import('./adminMetrics.js'));
});

afterEach(() => {
  orgStore.length = 0;
  projectStore.length = 0;
  orgMemberStore.length = 0;
  userTotal = 0;
  userNewIn30Days = 0;
  vi.clearAllMocks();
});

const NOW = new Date('2026-09-19T00:00:00Z');

function seedOrg(
  id: string,
  sub: Partial<NonNullable<MockOrg['BillingSubscription']>> | null,
  members = 0,
) {
  orgStore.push({
    id,
    deletedAt: null,
    BillingSubscription: sub
      ? {
          planCode: 'free',
          status: 'none',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null,
          gracePeriodEndsAt: null,
          ...sub,
        }
      : null,
  });
  for (let i = 0; i < members; i += 1) {
    orgMemberStore.push({ organizationId: id, deletedAt: null });
  }
}

function row(metrics: Awaited<ReturnType<typeof getPlatformMetrics>>, code: string) {
  return metrics.planBreakdown.find((r) => r.planCode === code)!;
}

describe('getPlatformMetrics', () => {
  it('会員数と直近 30 日の新規を返す', async () => {
    userTotal = 42;
    userNewIn30Days = 7;

    const m = await getPlatformMetrics(NOW);

    expect(m.users.total).toBe(42);
    expect(m.users.newIn30Days).toBe(7);
    expect(m.generatedAt).toBe(NOW.toISOString());
  });

  it('実効プラン別に組織数・会員数・プロジェクト数を振り分ける', async () => {
    seedOrg('o-free', { planCode: 'free', status: 'none' }, 1);
    seedOrg('o-personal', { planCode: 'personal', status: 'active' }, 1);
    seedOrg('o-team', { planCode: 'team', status: 'active' }, 5);
    projectStore.push(
      { organizationId: 'o-team', archivedAt: null, deletedAt: null },
      { organizationId: 'o-team', archivedAt: null, deletedAt: null },
      { organizationId: 'o-free', archivedAt: new Date(), deletedAt: null },
    );
    userTotal = 7;

    const m = await getPlatformMetrics(NOW);

    expect(row(m, 'free').organizationCount).toBe(1);
    expect(row(m, 'personal').organizationCount).toBe(1);
    expect(row(m, 'team')).toMatchObject({
      organizationCount: 1,
      memberCount: 5,
      activeProjectCount: 2,
    });
    expect(m.organizations).toEqual({ total: 3, paid: 2 });
    expect(m.projects).toEqual({ active: 2, archived: 1 });
  });

  it('解約済みの組織は有料として数えない', async () => {
    // 契約プランは team のまま残るが、実効プランは free
    seedOrg('o-canceled', { planCode: 'team', status: 'canceled' }, 3);
    userTotal = 3;

    const m = await getPlatformMetrics(NOW);

    expect(row(m, 'team').organizationCount).toBe(0);
    expect(row(m, 'free').organizationCount).toBe(1);
    expect(m.organizations.paid).toBe(0);
  });

  it('解約予約中でも期間内なら有料として数える', async () => {
    seedOrg(
      'o-pending-cancel',
      {
        planCode: 'personal',
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      },
      1,
    );
    userTotal = 1;

    const m = await getPlatformMetrics(NOW);

    expect(row(m, 'personal').organizationCount).toBe(1);
    expect(m.organizations.paid).toBe(1);
  });

  it('トライアル中の組織を別に数える', async () => {
    seedOrg('o-trial', { planCode: 'team', status: 'trialing' }, 2);
    userTotal = 2;

    const m = await getPlatformMetrics(NOW);

    expect(row(m, 'team')).toMatchObject({ organizationCount: 1, trialingCount: 1 });
  });

  it('契約行が無い組織は Free 扱いで落とす', async () => {
    // 組織と契約行は 1:1 のはずだが、行欠けで集計が落ちないようにする
    seedOrg('o-no-sub', null, 1);
    userTotal = 1;

    const m = await getPlatformMetrics(NOW);

    expect(row(m, 'free').organizationCount).toBe(1);
  });

  it('どの組織にも属していない会員を別に数える', async () => {
    seedOrg('o-1', { planCode: 'free', status: 'none' }, 2);
    userTotal = 5;

    const m = await getPlatformMetrics(NOW);

    expect(m.users.withoutOrganization).toBe(3);
  });

  it('プラン内訳は free → personal → team → enterprise の順で返す', async () => {
    const m = await getPlatformMetrics(NOW);
    expect(m.planBreakdown.map((r) => r.planCode)).toEqual([
      'free',
      'personal',
      'team',
      'enterprise',
    ]);
  });
});
