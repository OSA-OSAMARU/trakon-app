// -----------------------------------------------------------------------------
// Checkout / Customer Portal — 設計書 §7.4 / §7.8
//
// 【確定要件】
//   - quantity は常に 1。Team の人数上限は TRAKON 側で判定する
//   - trial_period_days = 5 (= 120 時間)。trial_end は使わない
//     (Checkout Session 作成〜申込完了の時間差だけトライアルが短縮されるため)
//   - payment_method_collection = 'always' (トライアル開始時もカード登録必須)
//   - automatic_tax は無効。税込 Price + 手動 Tax Rate で内訳を表示する
//   - success URL への遷移だけを根拠に有料権限を付与してはならない
//   - Portal Session URL は保存せず都度生成する
//
// Managed Payments について:
//   Stripe アカウントの既定で Managed Payments が有効だと、Stripe が税を代行する
//   前提になり automatic_tax[enabled]=true が必須になる。本設計は税込 Price +
//   手動 Tax Rate なので噛み合わず、Checkout Session の作成が弾かれる。
//   ダッシュボードの既定に依存しないよう、リクエスト側で明示的に無効化する
//   (STRIPE_PORTAL_CONFIGURATION_ID を明示指定するのと同じ理由)。
// -----------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';

import { prisma } from '@trakon/db';
import { TRIAL_PERIOD_DAYS, type BillingPlanCode } from '@trakon/shared';

import { getServerEnv } from '../../lib/env.js';
import { ApiException } from '../../lib/errors.js';
import { getStripe } from './stripeClient.js';
import { checkTrialEligibility } from './trialEligibility.js';

export type CheckoutablePlan = Extract<BillingPlanCode, 'personal' | 'team'>;

/** プランに対応する Price ID を env から引く。ID はコードに書かない (§7.3.3)。 */
function priceIdFor(plan: CheckoutablePlan): string {
  const env = getServerEnv();
  const priceId =
    plan === 'team' ? env.STRIPE_TEAM_MONTHLY_PRICE_ID : env.STRIPE_PERSONAL_MONTHLY_PRICE_ID;
  if (!priceId) {
    throw new ApiException(
      'BILLING_NOT_CONFIGURED',
      503,
      `Price ID for ${plan} is not configured.`,
    );
  }
  return priceId;
}

function taxRateIds(): string[] {
  const id = getServerEnv().STRIPE_JP_TAX_RATE_ID;
  return id ? [id] : [];
}

export async function createCheckoutSession(input: {
  organizationId: string;
  userId: string;
  planCode: CheckoutablePlan;
  origin: string;
}): Promise<{ url: string; trialApplied: boolean }> {
  const [subscription, user] = await Promise.all([
    prisma.billingSubscription.findUnique({ where: { organizationId: input.organizationId } }),
    prisma.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { email: true },
    }),
  ]);

  if (subscription?.stripeSubscriptionId && subscription.status === 'active') {
    throw new ApiException(
      'SUBSCRIPTION_ALREADY_ACTIVE',
      409,
      '既に有効な契約があります。プラン変更をご利用ください。',
    );
  }

  const eligibility = await checkTrialEligibility({
    userId: input.userId,
    organizationId: input.organizationId,
    email: user.email,
    stripeCustomerId: subscription?.stripeCustomerId ?? null,
  });

  const checkoutAttemptId = randomUUID();
  const metadata = {
    user_id: input.userId,
    organization_id: input.organizationId,
    plan_code: input.planCode,
    checkout_attempt_id: checkoutAttemptId,
    email: user.email,
  };

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    // quantity は常に 1。人数課金は行わない (§7.2.1)
    line_items: [{ price: priceIdFor(input.planCode), quantity: 1 }],
    automatic_tax: { enabled: false },
    // アカウント既定で有効でも、この決済では Stripe に税を代行させない
    managed_payments: { enabled: false },
    payment_method_collection: 'always',
    subscription_data: {
      // trial_end は使わない (§7.4.1)
      ...(eligibility.eligible ? { trial_period_days: TRIAL_PERIOD_DAYS } : {}),
      default_tax_rates: taxRateIds(),
      metadata,
    },
    metadata,
    ...(subscription?.stripeCustomerId
      ? { customer: subscription.stripeCustomerId }
      : { customer_email: user.email }),
    success_url: `${input.origin}/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/settings/billing?checkout=canceled`,
  });

  if (!session.url) {
    throw new ApiException('CHECKOUT_FAILED', 502, 'Stripe did not return a checkout URL.');
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: input.userId,
      action: eligibility.eligible ? 'checkout_started' : 'trial_blocked',
      resourceType: 'subscription',
      resourceId: input.organizationId,
      result: 'success',
      extra: {
        planCode: input.planCode,
        checkoutAttemptId,
        trialApplied: eligibility.eligible,
        ...(eligibility.reason ? { trialBlockedReason: eligibility.reason } : {}),
      },
    },
  });

  return { url: session.url, trialApplied: eligibility.eligible };
}

/**
 * Customer Portal のセッションを都度生成する。
 *
 * URL は保存しない (PRD SR-BILL-07)。プラン変更の無効化は Portal Configuration
 * 側の設定なので、構成 ID を明示指定してダッシュボードの既定に依存しない。
 */
export async function createPortalSession(input: {
  organizationId: string;
  origin: string;
}): Promise<{ url: string }> {
  const subscription = await prisma.billingSubscription.findUnique({
    where: { organizationId: input.organizationId },
    select: { stripeCustomerId: true },
  });
  if (!subscription?.stripeCustomerId) {
    throw new ApiException(
      'NO_STRIPE_CUSTOMER',
      409,
      'お支払い情報がまだ登録されていません。先にプランをお申し込みください。',
    );
  }

  const configuration = getServerEnv().STRIPE_PORTAL_CONFIGURATION_ID;
  const session = await getStripe().billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${input.origin}/settings/billing`,
    ...(configuration ? { configuration } : {}),
  });

  return { url: session.url };
}
