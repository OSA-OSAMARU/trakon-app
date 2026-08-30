import { prisma } from '@trakon/db';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __setMailerForTest } from '../../lib/mailer.js';
import { __setStripeForTest } from '../../services/billing/stripeClient.js';
import { createUser, primaryOrganizationId, setBillingSubscription } from '../../test/factories.js';

// =============================================================================
// Stripe Webhook (設計書 §7.5)
//
// ここが課金機能で最も壊れると痛い箇所なので、以下を重点的に検証する:
//   - 署名検証を通らないリクエストは DB を一切変更しない
//   - 同一イベントの二重配信で副作用が 2 回起きない (冪等性)
//   - イベントが逆順で届いても最終状態が壊れない
//   - Personal → Team は決済成功を確認するまで昇格しない
//
// CI から実 Stripe へは接続しない。署名は SDK のテストヘルパーで自作し、
// subscriptions.retrieve だけをスタブする。
// =============================================================================

const WEBHOOK_SECRET = 'whsec_test_secret_value';
const PERSONAL_PRICE = 'price_test_personal';
const TEAM_PRICE = 'price_test_team';

const signer = new Stripe('sk_test_dummy_key_for_signing');

/** Stripe が付ける署名ヘッダを自作する。 */
function signed(payload: unknown): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  const signature = signer.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  });
  return { body, signature };
}

/** app.request で直接叩く (raw body を保つため JSON 化しない) */
async function callWebhook(payload: unknown, overrideSignature?: string) {
  const { body, signature } = signed(payload);
  const { app } = await import('../../app.js');
  const res = await app.request('/api/v1/stripe/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': overrideSignature ?? signature,
    },
    body,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function subscriptionEvent(input: {
  id: string;
  type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted';
  created: number;
  organizationId: string;
  subscriptionId?: string;
  customerId?: string;
}) {
  return {
    id: input.id,
    object: 'event',
    api_version: '2024-06-20',
    created: input.created,
    type: input.type,
    data: {
      object: {
        id: input.subscriptionId ?? 'sub_test_1',
        object: 'subscription',
        customer: input.customerId ?? 'cus_test_1',
        metadata: { organization_id: input.organizationId },
      },
    },
  };
}

function invoiceEvent(input: {
  id: string;
  type: 'invoice.paid' | 'invoice.payment_failed';
  created: number;
  customerId?: string;
  invoiceId?: string;
}) {
  return {
    id: input.id,
    object: 'event',
    api_version: '2024-06-20',
    created: input.created,
    type: input.type,
    data: {
      object: {
        id: input.invoiceId ?? 'in_test_1',
        object: 'invoice',
        customer: input.customerId ?? 'cus_test_1',
        subscription: 'sub_test_1',
      },
    },
  };
}

/** subscriptions.retrieve のスタブ。返す状態と Price をテストごとに差し替える。 */
function stubStripe(retrieve: () => unknown) {
  __setStripeForTest({
    webhooks: signer.webhooks,
    subscriptions: { retrieve: async () => retrieve() },
  } as unknown as Stripe);
}

let organizationId: string;

beforeEach(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_signing';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_PERSONAL_MONTHLY_PRICE_ID = PERSONAL_PRICE;
  process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = TEAM_PRICE;

  __setMailerForTest({});

  const user = await createUser();
  organizationId = await primaryOrganizationId(user.id);
  await setBillingSubscription({ organizationId, stripeCustomerId: 'cus_test_1' });
});

afterEach(() => {
  __setStripeForTest(undefined);
});

function subscriptionPayload(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_test_1',
    object: 'subscription',
    customer: 'cus_test_1',
    status: 'active',
    cancel_at_period_end: false,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    current_period_start: 1_760_000_000,
    current_period_end: 1_762_000_000,
    metadata: { organization_id: organizationId },
    items: { data: [{ id: 'si_1', price: { id: TEAM_PRICE } }] },
    ...over,
  };
}

describe('署名検証', () => {
  describe('異常系', () => {
    it('署名が不正なら 400 を返し DB を変更しない', async () => {
      stubStripe(() => subscriptionPayload());

      const res = await callWebhook(
        subscriptionEvent({
          id: 'evt_bad',
          type: 'customer.subscription.updated',
          created: 1_760_000_100,
          organizationId,
        }),
        't=1,v1=deadbeef',
      );

      expect(res.status).toBe(400);
      expect(await prisma.stripeEvent.count()).toBe(0);
      const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
      expect(sub.planCode).toBe('free');
      expect(sub.status).toBe('none');
    });

    it('署名ヘッダが無ければ 400', async () => {
      const { app } = await import('../../app.js');
      const res = await app.request('/api/v1/stripe/webhook', { method: 'POST', body: '{}' });
      expect(res.status).toBe(400);
    });
  });
});

describe('冪等性', () => {
  it('同一イベントを 2 回受けても副作用は 1 回だけ', async () => {
    stubStripe(() => subscriptionPayload());
    const event = subscriptionEvent({
      id: 'evt_same',
      type: 'customer.subscription.updated',
      created: 1_760_000_100,
      organizationId,
    });

    const first = await callWebhook(event);
    const second = await callWebhook(event);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.body.data as Record<string, unknown>).duplicate).toBe(true);

    // 台帳も監査ログも 1 件のまま
    expect(await prisma.stripeEvent.count({ where: { stripeEventId: 'evt_same' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'subscription_updated' } })).toBe(1);
  });
});

describe('順序逆転', () => {
  it('古い created のイベントが後着しても最終状態が壊れない', async () => {
    // Stripe から取り直す現在値は常に active。ペイロードの中身ではなく
    // 「その時点の真の状態」を見るので、到着順に依存しない (§7.5.3)。
    stubStripe(() => subscriptionPayload({ status: 'active' }));

    await callWebhook(
      subscriptionEvent({
        id: 'evt_new',
        type: 'customer.subscription.updated',
        created: 1_760_000_200,
        organizationId,
      }),
    );
    await callWebhook(
      subscriptionEvent({
        id: 'evt_old',
        type: 'customer.subscription.created',
        created: 1_760_000_100,
        organizationId,
      }),
    );

    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.status).toBe('active');
    expect(sub.planCode).toBe('team');
  });
});

describe('プラン昇格', () => {
  it('契約が有効になると保留中のプラン変更が確定する', async () => {
    await setBillingSubscription({
      organizationId,
      planCode: 'personal',
      status: 'active',
      pendingPlanCode: 'team',
    });
    stubStripe(() => subscriptionPayload({ status: 'active' }));

    await callWebhook(
      subscriptionEvent({
        id: 'evt_promote',
        type: 'customer.subscription.updated',
        created: 1_760_000_300,
        organizationId,
      }),
    );

    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.planCode).toBe('team');
    expect(sub.pendingPlanCode).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'plan_changed' } })).toBe(1);
  });

  it('契約が incomplete のままなら昇格しない (決済成功の確認前)', async () => {
    await setBillingSubscription({
      organizationId,
      planCode: 'personal',
      status: 'active',
      pendingPlanCode: 'team',
    });
    stubStripe(() => subscriptionPayload({ status: 'incomplete' }));

    await callWebhook(
      subscriptionEvent({
        id: 'evt_incomplete',
        type: 'customer.subscription.updated',
        created: 1_760_000_400,
        organizationId,
      }),
    );

    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.planCode).toBe('personal');
    expect(sub.pendingPlanCode).toBe('team');
    expect(sub.status).toBe('incomplete');
  });

  it('invoice.paid でも保留中のプラン変更が確定する', async () => {
    await setBillingSubscription({
      organizationId,
      planCode: 'personal',
      status: 'past_due',
      pendingPlanCode: 'team',
      stripeSubscriptionId: 'sub_test_1',
    });
    stubStripe(() => subscriptionPayload());

    await callWebhook(
      invoiceEvent({ id: 'evt_paid', type: 'invoice.paid', created: 1_760_000_500 }),
    );

    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.planCode).toBe('team');
    expect(sub.status).toBe('active');
    expect(sub.pendingPlanCode).toBeNull();
  });
});

describe('支払い失敗と復旧', () => {
  it('失敗で past_due になり猶予期限が入る', async () => {
    stubStripe(() => subscriptionPayload());
    const created = 1_760_000_600;

    await callWebhook(
      invoiceEvent({ id: 'evt_failed', type: 'invoice.payment_failed', created }),
    );

    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.status).toBe('past_due');
    expect(sub.gracePeriodEndsAt).not.toBeNull();
    // 猶予は初回失敗 + 7 日
    const expected = new Date(created * 1000 + 7 * 24 * 60 * 60 * 1000);
    expect(sub.gracePeriodEndsAt?.getTime()).toBe(expected.getTime());
    expect(await prisma.auditLog.count({ where: { action: 'payment_failed' } })).toBe(1);
  });

  it('再試行で複数回失敗しても猶予期限は延びない', async () => {
    stubStripe(() => subscriptionPayload());
    await callWebhook(
      invoiceEvent({ id: 'evt_fail1', type: 'invoice.payment_failed', created: 1_760_000_600 }),
    );
    const first = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });

    await callWebhook(
      invoiceEvent({ id: 'evt_fail2', type: 'invoice.payment_failed', created: 1_760_100_000 }),
    );
    const second = await prisma.billingSubscription.findUniqueOrThrow({
      where: { organizationId },
    });

    expect(second.gracePeriodEndsAt?.getTime()).toBe(first.gracePeriodEndsAt?.getTime());
  });

  it('invoice.paid で active へ復旧し猶予がクリアされる', async () => {
    stubStripe(() => subscriptionPayload());
    await callWebhook(
      invoiceEvent({ id: 'evt_fail3', type: 'invoice.payment_failed', created: 1_760_000_600 }),
    );

    await callWebhook(
      invoiceEvent({ id: 'evt_paid2', type: 'invoice.paid', created: 1_760_000_700 }),
    );

    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.status).toBe('active');
    expect(sub.gracePeriodEndsAt).toBeNull();
    expect(sub.lastPaymentFailedAt).toBeNull();
  });
});

describe('監査ログ', () => {
  it('Webhook 起点の記録は操作者が空で、Stripe の ID は extra に入る', async () => {
    stubStripe(() => subscriptionPayload());

    await callWebhook(
      subscriptionEvent({
        id: 'evt_audit',
        type: 'customer.subscription.created',
        created: 1_760_000_800,
        organizationId,
      }),
    );

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'subscription_created' },
    });
    expect(log.actorUserId).toBeNull();
    expect(log.resourceType).toBe('subscription');
    // resource_id は uuid 型なので組織 ID を入れる
    expect(log.resourceId).toBe(organizationId);
    expect(log.extra).toMatchObject({ source: 'stripe_webhook', eventId: 'evt_audit' });
  });
});

describe('未対応イベント', () => {
  it('購読していないイベント種別は無視して 200 を返す', async () => {
    const res = await callWebhook({
      id: 'evt_ignored',
      object: 'event',
      created: 1_760_000_900,
      type: 'customer.created',
      data: { object: {} },
    });

    expect(res.status).toBe(200);
    expect((res.body.data as Record<string, unknown>).ignored).toBe(true);
    expect(await prisma.stripeEvent.count()).toBe(0);
  });
});
