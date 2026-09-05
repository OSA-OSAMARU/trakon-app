// -----------------------------------------------------------------------------
// プラン変更・解約 — 設計書 §7.7
//
// Personal → Team: 即時。残期間分を日割りで差額請求する。
//   **追加請求の決済成功を Webhook で確認するまで Team 権限を付与しない。**
//   DB には保留中のプラン変更としてのみ記録する。
//
// Team → Personal: 次回更新時に適用。返金しない。
//   会員 1 名以下・プロジェクト 10 件以下を条件とし、満たさなければ受け付けない。
//
// 解約: 期間終了時に解約する予約。返金しない。
//   **プロジェクトやメンバーを削除してはならない。** 本設計では凍結を計算で
//   表現するため、そもそも削除処理がコード上に存在しない。
// -----------------------------------------------------------------------------
import { prisma } from '@trakon/db';
import { BILLING_PLANS, type BillingPlanCode } from '@trakon/shared';

import { getServerEnv } from '../../lib/env.js';
import { ApiException } from '../../lib/errors.js';
import { countActiveProjects, countSeats } from '../organizations.js';
import { getStripe } from './stripeClient.js';

export type ChangeablePlan = Extract<BillingPlanCode, 'personal' | 'team'>;

type SubscriptionRow = NonNullable<
  Awaited<ReturnType<typeof prisma.billingSubscription.findUnique>>
>;

async function loadActiveSubscription(organizationId: string): Promise<SubscriptionRow> {
  const subscription = await prisma.billingSubscription.findUnique({
    where: { organizationId },
  });
  if (!subscription?.stripeSubscriptionId) {
    throw new ApiException(
      'NO_ACTIVE_SUBSCRIPTION',
      409,
      '有効な契約がありません。先にプランをお申し込みください。',
    );
  }
  return subscription;
}

function priceIdFor(plan: ChangeablePlan): string {
  const env = getServerEnv();
  const priceId =
    plan === 'team' ? env.STRIPE_TEAM_MONTHLY_PRICE_ID : env.STRIPE_PERSONAL_MONTHLY_PRICE_ID;
  if (!priceId) {
    throw new ApiException('BILLING_NOT_CONFIGURED', 503, `Price ID for ${plan} is not configured.`);
  }
  return priceId;
}

export async function changePlan(input: {
  organizationId: string;
  actorUserId: string;
  planCode: ChangeablePlan;
}): Promise<{ appliedImmediately: boolean; pendingPlanCode: BillingPlanCode }> {
  const subscription = await loadActiveSubscription(input.organizationId);

  if (subscription.planCode === input.planCode) {
    throw new ApiException('PLAN_UNCHANGED', 409, '既に同じプランをご利用中です。');
  }

  return input.planCode === 'team'
    ? upgradeToTeam({ ...input, subscription })
    : downgradeToPersonal({ ...input, subscription });
}

/** Personal → Team。即時変更・日割り差額請求。権限は決済成功の確認後に付与する。 */
async function upgradeToTeam(input: {
  organizationId: string;
  actorUserId: string;
  subscription: SubscriptionRow;
}): Promise<{ appliedImmediately: boolean; pendingPlanCode: BillingPlanCode }> {
  const stripe = getStripe();
  const current = await stripe.subscriptions.retrieve(input.subscription.stripeSubscriptionId!);
  const itemId = current.items?.data?.[0]?.id;
  if (!itemId) {
    throw new ApiException('SUBSCRIPTION_ITEM_NOT_FOUND', 502, 'Subscription item not found.');
  }

  await stripe.subscriptions.update(input.subscription.stripeSubscriptionId!, {
    items: [{ id: itemId, price: priceIdFor('team') }],
    // 残期間分の差額を日割りで請求する
    proration_behavior: 'always_invoice',
    // 追加請求の決済が完了するまで契約を保留状態にする
    payment_behavior: 'pending_if_incomplete',
  });

  // **plan_code はここで昇格させない。** invoice.paid か active な
  // subscription.updated を Webhook で受け取った時点で確定する (§7.7.1)。
  await prisma.$transaction([
    prisma.billingSubscription.update({
      where: { organizationId: input.organizationId },
      data: { pendingPlanCode: 'team', pendingPlanEffectiveAt: null },
    }),
    prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'plan_changed',
        resourceType: 'subscription',
        resourceId: input.organizationId,
        result: 'success',
        extra: { from: input.subscription.planCode, to: 'team', pending: true },
      },
    }),
  ]);

  return { appliedImmediately: false, pendingPlanCode: 'team' };
}

/** Team → Personal。次回更新時に適用。上限条件を満たさなければ受け付けない。 */
async function downgradeToPersonal(input: {
  organizationId: string;
  actorUserId: string;
  subscription: SubscriptionRow;
}): Promise<{ appliedImmediately: boolean; pendingPlanCode: BillingPlanCode }> {
  const target = BILLING_PLANS.personal;
  const [seatCount, projectCount] = await Promise.all([
    countSeats(prisma, input.organizationId),
    countActiveProjects(prisma, input.organizationId),
  ]);

  const overSeats = target.seatLimit !== null && seatCount > target.seatLimit;
  const overProjects = target.projectLimit !== null && projectCount > target.projectLimit;

  if (overSeats || overProjects) {
    // 何を整理すればよいか分かるよう、超過しているものを詳細で返す (§7.7.2)
    const excessProjects = overProjects
      ? await prisma.project.findMany({
          where: { organizationId: input.organizationId, deletedAt: null, archivedAt: null },
          orderBy: [{ retainedAt: 'desc' }, { createdAt: 'asc' }],
          skip: target.projectLimit ?? 0,
          select: { id: true, name: true },
        })
      : [];

    throw new ApiException(
      'PLAN_DOWNGRADE_BLOCKED',
      409,
      'Personal プランの上限を超えているため変更できません。メンバーまたはプロジェクトを整理してください。',
      {
        seatCount,
        seatLimit: target.seatLimit,
        projectCount,
        projectLimit: target.projectLimit,
        excessProjects,
      },
    );
  }

  const stripe = getStripe();
  const current = await stripe.subscriptions.retrieve(input.subscription.stripeSubscriptionId!);
  const item = current.items?.data?.[0];
  if (!item) {
    throw new ApiException('SUBSCRIPTION_ITEM_NOT_FOUND', 502, 'Subscription item not found.');
  }

  const periodEnd = readPeriodEnd(current, item);

  // 次回更新時に切り替える。返金は行わない (§7.7.2)
  await stripe.subscriptionSchedules
    .create({ from_subscription: input.subscription.stripeSubscriptionId! })
    .then((schedule) =>
      stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: 'release',
        phases: [
          {
            items: [{ price: item.price.id, quantity: 1 }],
            start_date: schedule.current_phase?.start_date ?? 'now',
            end_date: periodEnd ?? undefined,
          },
          {
            items: [{ price: priceIdFor('personal'), quantity: 1 }],
          },
        ],
      }),
    );

  await prisma.$transaction([
    prisma.billingSubscription.update({
      where: { organizationId: input.organizationId },
      data: {
        pendingPlanCode: 'personal',
        pendingPlanEffectiveAt: periodEnd ? new Date(periodEnd * 1000) : null,
      },
    }),
    prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'plan_changed',
        resourceType: 'subscription',
        resourceId: input.organizationId,
        result: 'success',
        extra: { from: input.subscription.planCode, to: 'personal', pending: true },
      },
    }),
  ]);

  return { appliedImmediately: false, pendingPlanCode: 'personal' };
}

/** 解約予約。支払済み期間の終了まで利用できる。データは削除しない。 */
export async function cancelSubscription(input: {
  organizationId: string;
  actorUserId: string;
}): Promise<{ cancelAtPeriodEnd: true; currentPeriodEnd: string | null }> {
  const subscription = await loadActiveSubscription(input.organizationId);

  const updated = await getStripe().subscriptions.update(subscription.stripeSubscriptionId!, {
    cancel_at_period_end: true,
  });

  const periodEnd = readPeriodEnd(updated, updated.items?.data?.[0]);

  await prisma.$transaction([
    prisma.billingSubscription.update({
      where: { organizationId: input.organizationId },
      data: {
        cancelAtPeriodEnd: true,
        canceledAt: new Date(),
        ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
      },
    }),
    prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'subscription_canceled',
        resourceType: 'subscription',
        resourceId: input.organizationId,
        result: 'success',
        extra: { cancelAtPeriodEnd: true },
      },
    }),
  ]);

  return {
    cancelAtPeriodEnd: true,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  };
}

/** 解約予約の取り消し。期間終了前であれば継続できる。 */
export async function resumeSubscription(input: {
  organizationId: string;
  actorUserId: string;
}): Promise<{ cancelAtPeriodEnd: false }> {
  const subscription = await loadActiveSubscription(input.organizationId);

  await getStripe().subscriptions.update(subscription.stripeSubscriptionId!, {
    cancel_at_period_end: false,
  });

  await prisma.$transaction([
    prisma.billingSubscription.update({
      where: { organizationId: input.organizationId },
      data: { cancelAtPeriodEnd: false, canceledAt: null },
    }),
    prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'subscription_updated',
        resourceType: 'subscription',
        resourceId: input.organizationId,
        result: 'success',
        extra: { cancelAtPeriodEnd: false, resumed: true },
      },
    }),
  ]);

  return { cancelAtPeriodEnd: false };
}

/**
 * 請求期間の終了は Stripe の API バージョンにより Subscription 直下か
 * Subscription Item 側に置かれる。どちらでも読めるようにする。
 */
function readPeriodEnd(subscription: unknown, item?: unknown): number | null {
  const fromItem = (item as Record<string, unknown> | undefined)?.current_period_end;
  if (typeof fromItem === 'number') return fromItem;
  const fromSub = (subscription as Record<string, unknown> | undefined)?.current_period_end;
  return typeof fromSub === 'number' ? fromSub : null;
}
