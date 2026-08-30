// -----------------------------------------------------------------------------
// Stripe Webhook の処理 — 設計書 §7.5
//
// 【確定要件】Checkout の success URL へ遷移したことのみをもって有料権限を
// 付与してはならない。Webhook で受信したイベントを正として DB へ反映し、
// その状態を根拠に権限判定する (PRD FR-BILL-05 / SR-BILL-03)。
//
// 冪等性・順序逆転への耐性:
//   - stripe_events の一意制約で二重処理を防ぐ
//   - 契約系イベントは受信ペイロードを信じず Stripe API から現在値を取り直す。
//     Stripe のイベント発生時刻は秒精度で、同一秒内の前後関係を判別できないため、
//     「その時点の真の状態」を取りに行くことで順序逆転が構造的に消える
//   - 外部 API 呼び出しはトランザクションの外で行う。Vercel 上では DB 接続が
//     1 本に制限されており、トランザクション内で数百 ms 占有すると
//     他のリクエストがプールタイムアウトする (章1 §1.2)
// -----------------------------------------------------------------------------
import type { Prisma } from '@prisma/client';
import type Stripe from 'stripe';

import { prisma } from '@trakon/db';
import { PAST_DUE_GRACE_DAYS, type BillingPlanCode, type SubscriptionStatus } from '@trakon/shared';

import { getStripe } from './stripeClient.js';

/** Webhook 1 件の処理結果。ルート側のレスポンスと台帳の記録に使う。 */
export type WebhookOutcome = {
  status: 'processed' | 'skipped';
  organizationId: string | null;
  /** コミット後に送るメール (送信失敗は握りつぶす) */
  notification?: BillingNotification;
};

export type BillingNotification =
  | { type: 'trial_will_end'; organizationId: string; trialEnd: Date | null }
  | { type: 'payment_failed'; organizationId: string; graceEndsAt: Date | null }
  | { type: 'payment_action_required'; organizationId: string }
  | { type: 'subscription_canceled'; organizationId: string };

/** 契約の「現在の真の状態」。Stripe API から取り直したものを詰める。 */
type SubscriptionSnapshot = {
  organizationId: string;
  planCode: BillingPlanCode;
  status: SubscriptionStatus;
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  stripePriceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
};

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

export function isSupportedEvent(type: string): boolean {
  return (
    SUBSCRIPTION_EVENTS.has(type) ||
    type === 'checkout.session.completed' ||
    type === 'customer.subscription.trial_will_end' ||
    type === 'invoice.paid' ||
    type === 'invoice.payment_failed' ||
    type === 'invoice.payment_action_required' ||
    type === 'invoice.updated'
  );
}

/**
 * イベントを DB へ反映する。トランザクション内で呼ばれ、外部 API は呼ばない。
 * (Stripe からの取り直しは呼び出し前に済ませてある)
 */
export async function applyEvent(
  tx: Prisma.TransactionClient,
  event: Stripe.Event,
  prefetched: { snapshot?: SubscriptionSnapshot | null },
): Promise<WebhookOutcome> {
  switch (event.type) {
    case 'checkout.session.completed':
      return applyCheckoutCompleted(tx, event);

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return applySubscriptionSnapshot(tx, event, prefetched.snapshot ?? null);

    case 'customer.subscription.trial_will_end':
      return applyTrialWillEnd(tx, event);

    case 'invoice.paid':
      return applyInvoicePaid(tx, event);

    case 'invoice.payment_failed':
      return applyInvoicePaymentFailed(tx, event);

    case 'invoice.payment_action_required':
      return applyInvoicePaymentActionRequired(tx, event);

    case 'invoice.updated':
      return applyInvoiceUpdated(tx, event);

    default:
      return { status: 'skipped', organizationId: null };
  }
}

/**
 * 契約系イベントについて、Stripe API から現在値を取り直す。
 * **トランザクションの外**で呼ぶこと。
 */
export async function prefetchSubscription(
  event: Stripe.Event,
): Promise<SubscriptionSnapshot | null> {
  if (!SUBSCRIPTION_EVENTS.has(event.type)) return null;
  const raw = event.data.object as Stripe.Subscription;
  const subscriptionId = raw.id;
  if (!subscriptionId) return null;

  let subscription: Stripe.Subscription;
  try {
    subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  } catch (err) {
    // 削除済みなどで取得できない場合は受信ペイロードで代替する
    console.warn('[stripe] subscription retrieve failed, falling back to payload:', err);
    subscription = raw;
  }

  const organizationId = await resolveOrganizationId({
    metadata: subscription.metadata,
    customerId: typeof subscription.customer === 'string' ? subscription.customer : null,
    subscriptionId,
  });
  if (!organizationId) return null;

  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id ?? null;

  return {
    organizationId,
    planCode: planCodeFromPriceId(priceId),
    status: normalizeStatus(subscription.status, event.type),
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null,
    stripePriceId: priceId,
    currentPeriodStart: toDate(readEpoch(item, subscription, 'current_period_start')),
    currentPeriodEnd: toDate(readEpoch(item, subscription, 'current_period_end')),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: toDate(subscription.canceled_at),
    trialStart: toDate(subscription.trial_start),
    trialEnd: toDate(subscription.trial_end),
  };
}

// -----------------------------------------------------------------------------
// イベント別の処理
// -----------------------------------------------------------------------------

async function applyCheckoutCompleted(
  tx: Prisma.TransactionClient,
  event: Stripe.Event,
): Promise<WebhookOutcome> {
  const session = event.data.object as Stripe.Checkout.Session;
  const organizationId = session.metadata?.organization_id ?? null;
  if (!organizationId) return { status: 'skipped', organizationId: null };

  const customerId = typeof session.customer === 'string' ? session.customer : null;
  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : null;

  // 顧客 ID を確定する。**ここでは plan_code を昇格しない**。
  // 昇格は契約が有効になった時点 (subscription.updated / invoice.paid) で行う。
  await tx.billingSubscription.update({
    where: { organizationId },
    data: {
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
      lastStripeEventId: event.id,
      lastStripeEventAt: new Date(event.created * 1000),
    },
  });

  // トライアル利用履歴を記録する (重複判定に使う)
  const email = (session.customer_details?.email ?? session.metadata?.email ?? '').toLowerCase();
  if (email) {
    const existing = await tx.billingTrialClaim.findFirst({
      where: { emailNormalized: email, releasedAt: null },
      select: { id: true },
    });
    if (!existing) {
      await tx.billingTrialClaim.create({
        data: {
          organizationId,
          userId: session.metadata?.user_id ?? null,
          emailNormalized: email,
          emailDomain: email.split('@')[1] ?? '',
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
        },
      });
    }
  }

  await audit(tx, {
    action: 'trial_started',
    organizationId,
    eventId: event.id,
    extra: { planCode: session.metadata?.plan_code ?? null, subscriptionId },
  });

  return { status: 'processed', organizationId };
}

async function applySubscriptionSnapshot(
  tx: Prisma.TransactionClient,
  event: Stripe.Event,
  snapshot: SubscriptionSnapshot | null,
): Promise<WebhookOutcome> {
  if (!snapshot) return { status: 'skipped', organizationId: null };

  const current = await tx.billingSubscription.findUnique({
    where: { organizationId: snapshot.organizationId },
  });
  if (!current) return { status: 'skipped', organizationId: null };

  const deleted = event.type === 'customer.subscription.deleted';
  const active = snapshot.status === 'active' || snapshot.status === 'trialing';

  // 保留中のプラン変更は、契約が有効になった時点で確定する。
  // 追加請求の決済成功を確認するまで Team 権限を付与しない (FR-BILL-07)。
  const promotesPendingPlan =
    active && current.pendingPlanCode !== null && snapshot.planCode === current.pendingPlanCode;

  const planCode = deleted
    ? current.planCode
    : active
      ? snapshot.planCode
      : current.planCode;

  await tx.billingSubscription.update({
    where: { organizationId: snapshot.organizationId },
    data: {
      planCode,
      status: snapshot.status,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      ...(snapshot.stripeCustomerId ? { stripeCustomerId: snapshot.stripeCustomerId } : {}),
      stripePriceId: snapshot.stripePriceId,
      currentPeriodStart: snapshot.currentPeriodStart,
      currentPeriodEnd: snapshot.currentPeriodEnd,
      cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
      canceledAt: snapshot.canceledAt,
      trialStart: snapshot.trialStart,
      trialEnd: snapshot.trialEnd,
      ...(snapshot.trialStart ? { trialUsedAt: current.trialUsedAt ?? snapshot.trialStart } : {}),
      ...(promotesPendingPlan ? { pendingPlanCode: null, pendingPlanEffectiveAt: null } : {}),
      // 有効化されたら猶予をクリアする
      ...(active ? { gracePeriodEndsAt: null, lastPaymentFailedAt: null } : {}),
      lastStripeEventId: event.id,
      lastStripeEventAt: new Date(event.created * 1000),
    },
  });

  const action =
    event.type === 'customer.subscription.created'
      ? 'subscription_created'
      : deleted
        ? 'subscription_canceled'
        : 'subscription_updated';

  await audit(tx, {
    action,
    organizationId: snapshot.organizationId,
    eventId: event.id,
    extra: {
      status: snapshot.status,
      planCode,
      subscriptionId: snapshot.stripeSubscriptionId,
      ...(promotesPendingPlan ? { promotedFrom: current.planCode } : {}),
    },
  });

  if (promotesPendingPlan) {
    await audit(tx, {
      action: 'plan_changed',
      organizationId: snapshot.organizationId,
      eventId: event.id,
      extra: { from: current.planCode, to: planCode },
    });
  }

  return {
    status: 'processed',
    organizationId: snapshot.organizationId,
    ...(deleted
      ? {
          notification: {
            type: 'subscription_canceled' as const,
            organizationId: snapshot.organizationId,
          },
        }
      : {}),
  };
}

async function applyTrialWillEnd(
  tx: Prisma.TransactionClient,
  event: Stripe.Event,
): Promise<WebhookOutcome> {
  const subscription = event.data.object as Stripe.Subscription;
  const organizationId = await resolveOrganizationIdTx(tx, subscription);
  if (!organizationId) return { status: 'skipped', organizationId: null };

  return {
    status: 'processed',
    organizationId,
    notification: {
      type: 'trial_will_end',
      organizationId,
      trialEnd: toDate(subscription.trial_end),
    },
  };
}

async function applyInvoicePaid(
  tx: Prisma.TransactionClient,
  event: Stripe.Event,
): Promise<WebhookOutcome> {
  const invoice = event.data.object as Stripe.Invoice;
  const current = await findByInvoice(tx, invoice);
  if (!current) return { status: 'skipped', organizationId: null };

  // 保留中のプラン変更はここで確定する (Personal → Team の追加請求成功の確認点)
  const promoted = current.pendingPlanCode;

  await tx.billingSubscription.update({
    where: { id: current.id },
    data: {
      status: 'active',
      ...(promoted ? { planCode: promoted, pendingPlanCode: null, pendingPlanEffectiveAt: null } : {}),
      latestInvoiceId: invoice.id ?? null,
      gracePeriodEndsAt: null,
      lastPaymentFailedAt: null,
      lastStripeEventId: event.id,
      lastStripeEventAt: new Date(event.created * 1000),
    },
  });

  await audit(tx, {
    action: 'payment_recovered',
    organizationId: current.organizationId,
    eventId: event.id,
    extra: { invoiceId: invoice.id ?? null },
  });

  if (promoted) {
    await audit(tx, {
      action: 'plan_changed',
      organizationId: current.organizationId,
      eventId: event.id,
      extra: { from: current.planCode, to: promoted },
    });
  }

  return { status: 'processed', organizationId: current.organizationId };
}

async function applyInvoicePaymentFailed(
  tx: Prisma.TransactionClient,
  event: Stripe.Event,
): Promise<WebhookOutcome> {
  const invoice = event.data.object as Stripe.Invoice;
  const current = await findByInvoice(tx, invoice);
  if (!current) return { status: 'skipped', organizationId: null };

  const failedAt = new Date(event.created * 1000);
  // 猶予は「初回失敗 + 7日」。再試行のたびに延ばさない (§7.10.2)
  const graceEndsAt =
    current.gracePeriodEndsAt ??
    new Date(failedAt.getTime() + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000);

  await tx.billingSubscription.update({
    where: { id: current.id },
    data: {
      status: 'past_due',
      lastPaymentFailedAt: failedAt,
      gracePeriodEndsAt: graceEndsAt,
      latestInvoiceId: invoice.id ?? null,
      lastStripeEventId: event.id,
      lastStripeEventAt: failedAt,
    },
  });

  await audit(tx, {
    action: 'payment_failed',
    organizationId: current.organizationId,
    eventId: event.id,
    extra: { invoiceId: invoice.id ?? null, graceEndsAt: graceEndsAt.toISOString() },
  });

  return {
    status: 'processed',
    organizationId: current.organizationId,
    notification: {
      type: 'payment_failed',
      organizationId: current.organizationId,
      graceEndsAt,
    },
  };
}

async function applyInvoicePaymentActionRequired(
  tx: Prisma.TransactionClient,
  event: Stripe.Event,
): Promise<WebhookOutcome> {
  const invoice = event.data.object as Stripe.Invoice;
  const current = await findByInvoice(tx, invoice);
  if (!current) return { status: 'skipped', organizationId: null };

  await tx.billingSubscription.update({
    where: { id: current.id },
    data: {
      status: 'past_due',
      latestInvoiceId: invoice.id ?? null,
      lastStripeEventId: event.id,
      lastStripeEventAt: new Date(event.created * 1000),
    },
  });

  return {
    status: 'processed',
    organizationId: current.organizationId,
    notification: { type: 'payment_action_required', organizationId: current.organizationId },
  };
}

async function applyInvoiceUpdated(
  tx: Prisma.TransactionClient,
  event: Stripe.Event,
): Promise<WebhookOutcome> {
  const invoice = event.data.object as Stripe.Invoice;
  const current = await findByInvoice(tx, invoice);
  if (!current) return { status: 'skipped', organizationId: null };

  await tx.billingSubscription.update({
    where: { id: current.id },
    data: {
      latestInvoiceId: invoice.id ?? null,
      lastStripeEventId: event.id,
      lastStripeEventAt: new Date(event.created * 1000),
    },
  });

  return { status: 'processed', organizationId: current.organizationId };
}

// -----------------------------------------------------------------------------
// ヘルパー
// -----------------------------------------------------------------------------

/**
 * 請求書系イベントは、最終反映イベントより古いものをスキップする。
 * (契約系は現在値を取り直すのでこのガードを使わない)
 */
export function isStaleInvoiceEvent(
  event: Stripe.Event,
  lastEventAt: Date | null | undefined,
): boolean {
  if (!event.type.startsWith('invoice.')) return false;
  if (!lastEventAt) return false;
  return event.created * 1000 < lastEventAt.getTime();
}

async function findByInvoice(tx: Prisma.TransactionClient, invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
  if (customerId) {
    const byCustomer = await tx.billingSubscription.findUnique({
      where: { stripeCustomerId: customerId },
    });
    if (byCustomer) return byCustomer;
  }
  const subscriptionId = readInvoiceSubscriptionId(invoice);
  if (subscriptionId) {
    return tx.billingSubscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
  }
  return null;
}

async function resolveOrganizationIdTx(
  tx: Prisma.TransactionClient,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.organization_id;
  if (fromMetadata) return fromMetadata;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;
  if (!customerId) return null;
  const row = await tx.billingSubscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { organizationId: true },
  });
  return row?.organizationId ?? null;
}

async function resolveOrganizationId(input: {
  metadata: Stripe.Metadata | null | undefined;
  customerId: string | null;
  subscriptionId: string;
}): Promise<string | null> {
  const fromMetadata = input.metadata?.organization_id;
  if (fromMetadata) return fromMetadata;

  const row = await prisma.billingSubscription.findFirst({
    where: {
      OR: [
        ...(input.customerId ? [{ stripeCustomerId: input.customerId }] : []),
        { stripeSubscriptionId: input.subscriptionId },
      ],
    },
    select: { organizationId: true },
  });
  return row?.organizationId ?? null;
}

/**
 * Price ID からプランを判定する。ID は環境変数でのみ管理し (本番/テストで別値)、
 * ソースコードには書かない (設計書 §7.3.3)。
 */
function planCodeFromPriceId(priceId: string | null): BillingPlanCode {
  if (!priceId) return 'free';
  const env = process.env;
  if (priceId === env.STRIPE_TEAM_MONTHLY_PRICE_ID) return 'team';
  if (priceId === env.STRIPE_PERSONAL_MONTHLY_PRICE_ID) return 'personal';
  return 'free';
}

function normalizeStatus(status: string, eventType: string): SubscriptionStatus {
  if (eventType === 'customer.subscription.deleted') return 'canceled';
  const allowed: SubscriptionStatus[] = [
    'trialing',
    'active',
    'past_due',
    'unpaid',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'paused',
  ];
  return allowed.includes(status as SubscriptionSnapshot['status'])
    ? (status as SubscriptionStatus)
    : 'none';
}

/**
 * 請求期間は Stripe の API バージョンによって Subscription 直下か
 * Subscription Item 側に置かれる。どちらでも読めるようにする。
 */
function readEpoch(
  item: Stripe.SubscriptionItem | undefined,
  subscription: Stripe.Subscription,
  key: 'current_period_start' | 'current_period_end',
): number | null {
  const fromItem = (item as unknown as Record<string, unknown> | undefined)?.[key];
  if (typeof fromItem === 'number') return fromItem;
  const fromSub = (subscription as unknown as Record<string, unknown>)[key];
  return typeof fromSub === 'number' ? fromSub : null;
}

function readInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = (invoice as unknown as Record<string, unknown>).subscription;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'id' in raw) {
    const id = (raw as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function toDate(epochSeconds: number | null | undefined): Date | null {
  return typeof epochSeconds === 'number' ? new Date(epochSeconds * 1000) : null;
}

/**
 * 課金系の監査ログ。
 * audit_logs.resource_id は uuid 型なので Stripe の ID は入らない。
 * resource_id には組織 ID を入れ、Stripe 側の ID は extra へ (設計書 §2.4.7)。
 */
async function audit(
  tx: Prisma.TransactionClient,
  input: {
    action: string;
    organizationId: string;
    eventId: string;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      // Webhook 起点なので操作者は存在しない
      actorUserId: null,
      action: input.action,
      resourceType: 'subscription',
      resourceId: input.organizationId,
      result: 'success',
      extra: { source: 'stripe_webhook', eventId: input.eventId, ...(input.extra ?? {}) },
    },
  });
}
