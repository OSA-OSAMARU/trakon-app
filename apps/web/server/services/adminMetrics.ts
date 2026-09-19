// -----------------------------------------------------------------------------
// 運営向けの集計 (#204)
//
// 見たいのは「いま何人が使っていて、そのうち何人が有料か」。
// **金額は扱わない** — 売上・請求・返金は Stripe ダッシュボードが正であり、
// ここで二重に持つと必ずズレて、どちらが正しいか言えなくなる。
// この画面は「Stripe を見に行く前に、人数の傾向を掴む」ためのもの。
// -----------------------------------------------------------------------------
import { prisma } from '@trakon/db';
import {
  BILLING_PLAN_CODES,
  evaluateEntitlement,
  FREE_SUBSCRIPTION_DEFAULTS,
  type BillingPlanCode,
  type SubscriptionStatus,
} from '@trakon/shared';

export type PlanBreakdownRow = {
  planCode: BillingPlanCode;
  /** その実効プランの組織数 */
  organizationCount: number;
  /** その組織に所属している会員アカウント数 (重複あり: 複数組織に属する人は各組織で数える) */
  memberCount: number;
  /** その組織が持つアクティブなプロジェクト数 */
  activeProjectCount: number;
  /** トライアル中の組織数。有料への入口にどれだけ人がいるか */
  trialingCount: number;
};

export type PlatformMetrics = {
  /** 集計時刻 (ISO)。画面に出して「いつ時点の数字か」を明示する */
  generatedAt: string;
  users: {
    /** 退会していない会員アカウント総数 */
    total: number;
    /** 直近 30 日に登録した数 */
    newIn30Days: number;
    /** プロフィール登録済みだがどの組織にも属していない数 (通常は 0) */
    withoutOrganization: number;
  };
  organizations: {
    total: number;
    /** 実効プランが free 以外の組織数 */
    paid: number;
  };
  projects: {
    active: number;
    archived: number;
  };
  /** 実効プラン別の内訳。free → personal → team → enterprise の順 */
  planBreakdown: PlanBreakdownRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * プラットフォーム全体の利用状況を集計する。
 *
 * **実効プラン**で数える。契約プランのまま数えると、解約済みや支払い不能の組織が
 * 有料として計上され、「課金されていないのに Team が 10 件」という読み違いを生む。
 * 実効プランの判定は `evaluateEntitlement` に委ねて、画面の判定とずれないようにする。
 */
export async function getPlatformMetrics(now: Date = new Date()): Promise<PlatformMetrics> {
  const since30d = new Date(now.getTime() - 30 * DAY_MS);

  const [userTotal, newIn30Days, organizations, projects, memberCounts] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: since30d } } }),
    prisma.organization.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        BillingSubscription: {
          select: {
            planCode: true,
            status: true,
            cancelAtPeriodEnd: true,
            currentPeriodEnd: true,
            gracePeriodEndsAt: true,
          },
        },
      },
    }),
    prisma.project.findMany({
      where: { deletedAt: null },
      select: { organizationId: true, archivedAt: true },
    }),
    prisma.organizationMember.groupBy({
      by: ['organizationId'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const membersByOrg = new Map(memberCounts.map((m) => [m.organizationId, m._count._all]));

  const activeProjectsByOrg = new Map<string, number>();
  let activeProjects = 0;
  let archivedProjects = 0;
  for (const p of projects) {
    if (p.archivedAt) {
      archivedProjects += 1;
      continue;
    }
    activeProjects += 1;
    activeProjectsByOrg.set(p.organizationId, (activeProjectsByOrg.get(p.organizationId) ?? 0) + 1);
  }

  const rows = new Map<BillingPlanCode, PlanBreakdownRow>(
    BILLING_PLAN_CODES.map((code) => [
      code,
      {
        planCode: code,
        organizationCount: 0,
        memberCount: 0,
        activeProjectCount: 0,
        trialingCount: 0,
      },
    ]),
  );

  let paidOrganizations = 0;
  let membersInOrganizations = 0;

  for (const org of organizations) {
    const sub = org.BillingSubscription;
    // 契約行は組織と 1:1 だが、移行途中の行欠けに備えて Free 扱いで落とす (§2.4.12)
    const entitlement = evaluateEntitlement({
      planCode: (sub?.planCode as BillingPlanCode) ?? FREE_SUBSCRIPTION_DEFAULTS.planCode,
      status: (sub?.status as SubscriptionStatus) ?? FREE_SUBSCRIPTION_DEFAULTS.status,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      gracePeriodEndsAt: sub?.gracePeriodEndsAt ?? null,
      // 上限超過の判定はここでは要らない。実効プランだけが欲しい
      seatCount: 0,
      viewerCount: 0,
      projectCount: 0,
      now,
    });

    const row = rows.get(entitlement.effectivePlanCode)!;
    const members = membersByOrg.get(org.id) ?? 0;
    row.organizationCount += 1;
    row.memberCount += members;
    row.activeProjectCount += activeProjectsByOrg.get(org.id) ?? 0;
    if (sub?.status === 'trialing') row.trialingCount += 1;

    membersInOrganizations += members;
    if (entitlement.effectivePlanCode !== 'free') paidOrganizations += 1;
  }

  return {
    generatedAt: now.toISOString(),
    users: {
      total: userTotal,
      newIn30Days,
      // 組織に属さない会員は本来 0。増えていたら登録フローの取りこぼしを疑う
      withoutOrganization: Math.max(userTotal - membersInOrganizations, 0),
    },
    organizations: {
      total: organizations.length,
      paid: paidOrganizations,
    },
    projects: { active: activeProjects, archived: archivedProjects },
    planBreakdown: BILLING_PLAN_CODES.map((code) => rows.get(code)!),
  };
}
