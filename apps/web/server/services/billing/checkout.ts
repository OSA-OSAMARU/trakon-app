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
import {
  hasLiveSubscription,
  TRIAL_PERIOD_DAYS,
  type BillingPlanCode,
  type SubscriptionStatus,
} from '@trakon/shared';

import { getServerEnv } from '../../lib/env.js';
import { ApiException } from '../../lib/errors.js';
import { captureServerError } from '../../lib/sentry.js';
import { reconcileSubscription } from './reconcile.js';
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

/**
 * 二重契約の防止 (#241)。
 *
 * 申し込みは「新しい Subscription を作る」操作なので、既に契約がある状態で
 * もう一度通してしまうと**同じ顧客に 2 本の契約ができ、二重に請求される**。
 * プラン変更 (`/billing/plan`) は既存の契約を書き換えるだけなので、この危険は無い。
 *
 * 見るのは 2 段階。
 *   1. 手元の契約行。`active` だけでなく **trialing / past_due / incomplete など
 *      「Stripe 上に生きている契約がある」状態すべて**で止める。トライアル中に
 *      もう一度申し込めてしまうのが一番危ない (#241)。
 *   2. 手元が「契約なし」でも Stripe に直接聞く。Webhook が届いていない間は
 *      手元が Free のままになるため (#209 / #235 で実際に起きた)、ここを手元の
 *      状態だけで判断すると素通りする。
 */
async function assertNoLiveSubscription(input: {
  organizationId: string;
  subscription: { stripeSubscriptionId: string | null; stripeCustomerId: string | null; status: string } | null;
}): Promise<void> {
  const { subscription } = input;

  if (
    subscription?.stripeSubscriptionId &&
    hasLiveSubscription(subscription.status as SubscriptionStatus)
  ) {
    throw alreadyActive();
  }

  if (!subscription?.stripeCustomerId) return;

  const live = await listLiveSubscriptions(subscription.stripeCustomerId);
  if (live.length === 0) return;

  // 画面は「契約なし」のまま止まっているはず。ここで現在値へ合わせておく (#209)。
  // 合わせられなくても**申し込みは通さない** — 二重契約より表示のずれの方が軽い。
  try {
    await reconcileSubscription({ organizationId: input.organizationId });
  } catch (err) {
    console.warn('[stripe] reconcile after duplicate check failed:', err);
  }
  throw alreadyActive();
}

function alreadyActive(): ApiException {
  return new ApiException(
    'SUBSCRIPTION_ALREADY_ACTIVE',
    409,
    '既に有効な契約があります。プラン変更をご利用ください。',
  );
}

/**
 * 顧客が持っている「生きている契約」を Stripe から引く (#241)。
 *
 * 取得に失敗したときは**申し込みを通さない**。ここで通すと、既に契約があっても
 * 気づけずに 2 本目を作ってしまう。止めても失うのは申し込みの再試行だけで済む。
 */
async function listLiveSubscriptions(customerId: string) {
  let list;
  try {
    list = await getStripe().subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  } catch (err) {
    console.warn('[stripe] subscription list failed on duplicate check:', err);
    throw new ApiException(
      'SUBSCRIPTION_CHECK_FAILED',
      503,
      '契約状態を確認できませんでした。時間をおいてもう一度お試しください。',
    );
  }

  const live = list.data.filter((s) => hasLiveSubscription(s.status as SubscriptionStatus));

  // 既に 2 本以上あるなら、どこかで二重契約が起きている。黙って通すと
  // 請求が二重のまま続くので、気づける形で残す (自動では解約しない)
  if (live.length > 1) {
    captureServerError(new Error('duplicate live subscriptions on one customer'), {
      customerId,
      subscriptionIds: live.map((s) => s.id),
    });
  }

  return live;
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

  await assertNoLiveSubscription({
    organizationId: input.organizationId,
    subscription,
  });

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
