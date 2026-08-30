// -----------------------------------------------------------------------------
// 利用権限の解決 — 設計書 §7.6
//
// 判定ロジックそのものは packages/shared の evaluateEntitlement が持つ。
// ここは DB から入力を組み立てて渡すだけにする。
// 「アプリ全体で単一の判定関数を共用する」という【確定】要件を守るため、
// 条件分岐をここに書かない。
// -----------------------------------------------------------------------------
import type { Prisma } from '@prisma/client';

import { prisma } from '@trakon/db';
import {
  evaluateEntitlement,
  FREE_SUBSCRIPTION_DEFAULTS,
  selectFrozenProjectIds,
  type BillingPlanCode,
  type Entitlement,
  type SubscriptionStatus,
} from '@trakon/shared';

import { countActiveProjects, countSeats } from '../organizations.js';

type Db = Prisma.TransactionClient | typeof prisma;

export type BillingSubscriptionSummary = {
  planCode: BillingPlanCode;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  gracePeriodEndsAt: string | null;
  pendingPlanCode: BillingPlanCode | null;
  pendingPlanEffectiveAt: string | null;
  paymentMethod: { brand: string | null; last4: string | null } | null;
  hasStripeCustomer: boolean;
};

export type OrganizationBillingDTO = {
  organizationId: string;
  organizationName: string;
  subscription: BillingSubscriptionSummary;
  entitlement: Entitlement;
  /** 上限超過で閲覧のみになっているプロジェクト */
  frozenProjectIds: string[];
};

/**
 * 組織の利用権限を求める。
 *
 * 座席数・プロジェクト数のカウントを伴うので、書き込み系エンドポイントの
 * 上限チェックなど**必要なときだけ**呼ぶ (全リクエストでは呼ばない、§7.11.1)。
 */
export async function getEntitlement(db: Db, organizationId: string): Promise<Entitlement> {
  const [subscription, seatCount, projectCount] = await Promise.all([
    db.billingSubscription.findUnique({ where: { organizationId } }),
    countSeats(db, organizationId),
    countActiveProjects(db, organizationId),
  ]);

  return evaluateEntitlement({
    planCode: (subscription?.planCode as BillingPlanCode) ?? FREE_SUBSCRIPTION_DEFAULTS.planCode,
    status: (subscription?.status as SubscriptionStatus) ?? FREE_SUBSCRIPTION_DEFAULTS.status,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    gracePeriodEndsAt: subscription?.gracePeriodEndsAt ?? null,
    seatCount,
    projectCount,
  });
}

/** 画面表示用に、契約情報と利用権限・凍結状態をまとめて返す。 */
export async function getOrganizationBilling(
  organizationId: string,
): Promise<OrganizationBillingDTO> {
  const [organization, subscription, seatCount, projects] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true },
    }),
    prisma.billingSubscription.findUnique({ where: { organizationId } }),
    countSeats(prisma, organizationId),
    prisma.project.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, createdAt: true, archivedAt: true, retainedAt: true },
    }),
  ]);

  const activeProjects = projects.filter((p) => p.archivedAt === null);

  const entitlement = evaluateEntitlement({
    planCode: (subscription?.planCode as BillingPlanCode) ?? FREE_SUBSCRIPTION_DEFAULTS.planCode,
    status: (subscription?.status as SubscriptionStatus) ?? FREE_SUBSCRIPTION_DEFAULTS.status,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    gracePeriodEndsAt: subscription?.gracePeriodEndsAt ?? null,
    seatCount,
    projectCount: activeProjects.length,
  });

  const { frozenIds } = selectFrozenProjectIds(projects, entitlement.limits.projectLimit);

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    subscription: {
      planCode: (subscription?.planCode as BillingPlanCode) ?? 'free',
      status: (subscription?.status as SubscriptionStatus) ?? 'none',
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
      trialEnd: subscription?.trialEnd?.toISOString() ?? null,
      gracePeriodEndsAt: subscription?.gracePeriodEndsAt?.toISOString() ?? null,
      pendingPlanCode: (subscription?.pendingPlanCode as BillingPlanCode | null) ?? null,
      pendingPlanEffectiveAt: subscription?.pendingPlanEffectiveAt?.toISOString() ?? null,
      paymentMethod: subscription?.defaultPaymentMethodLast4
        ? {
            brand: subscription.defaultPaymentMethodBrand,
            last4: subscription.defaultPaymentMethodLast4,
          }
        : null,
      hasStripeCustomer: Boolean(subscription?.stripeCustomerId),
    },
    entitlement,
    frozenProjectIds: frozenIds,
  };
}
