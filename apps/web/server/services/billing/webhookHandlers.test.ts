import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __setStripeForTest } from './stripeClient.js';
import {
  applyEvent,
  isStaleInvoiceEvent,
  isSupportedEvent,
  prefetchSubscription,
} from './webhookHandlers.js';

// =============================================================================
// Webhook 処理の単体テスト (設計書 §7.5)
//
// 実 Stripe には CI から一切接続しない。__setStripeForTest で差し込む。
// 署名検証・冪等性・実 DB への反映は stripeWebhook.integration.test.ts が見る。
// ここでは「イベント 1 件を受けて DB に何を書くか」の判断だけを固定する。
// =============================================================================

// vi.mock はファイル先頭へ巻き上げられるため、参照する値も vi.hoisted で先に作る
const prismaMock = vi.hoisted(() => ({
  billingSubscription: { findFirst: vi.fn() },
}));
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

type Row = {
  id: string;
  organizationId: string;
  planCode: string;
  status: string;
  pendingPlanCode: string | null;
  trialUsedAt: Date | null;
  gracePeriodEndsAt: Date | null;
  stripeCustomerId: string | null;
};

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'bs-1',
    organizationId: 'org-1',
    planCode: 'free',
    status: 'none',
    pendingPlanCode: null,
    trialUsedAt: null,
    gracePeriodEndsAt: null,
    stripeCustomerId: 'cus_1',
    ...over,
  };
}

/** applyEvent に渡すトランザクションクライアントの代役。書き込み内容を記録する。 */
function fakeTx(current: Row | null = row()) {
  // 引数の型を明示する (mock.calls から data を読むため)
  const update = vi.fn<(args: { data: Record<string, unknown> }) => Promise<object>>(
    async () => ({}),
  );
  const claimCreate = vi.fn<(args: { data: Record<string, unknown> }) => Promise<object>>(
    async () => ({}),
  );
  const auditCreate = vi.fn<(args: { data: { action: string } }) => Promise<object>>(
    async () => ({}),
  );
  const tx = {
    billingSubscription: {
      findUnique: vi.fn(async () => current),
      update,
    },
    billingTrialClaim: {
      findFirst: vi.fn(async () => null),
      create: claimCreate,
    },
    auditLog: { create: auditCreate },
  };
  return {
    tx: tx as unknown as Parameters<typeof applyEvent>[0],
    update,
    claimCreate,
    auditCreate,
    raw: tx,
    /** 直近の update に渡された data */
    data: () => update.mock.calls.at(-1)?.[0].data as Record<string, unknown>,
    actions: () => auditCreate.mock.calls.map((c) => c[0].data.action as string),
  };
}

const CREATED_AT = Math.floor(new Date('2026-09-01T00:00:00Z').getTime() / 1000);

function event(type: string, object: unknown, over: Partial<Stripe.Event> = {}): Stripe.Event {
  return { id: 'evt_1', type, created: CREATED_AT, data: { object }, ...over } as Stripe.Event;
}

beforeEach(() => {
  process.env.STRIPE_PERSONAL_MONTHLY_PRICE_ID = 'price_personal_test';
  process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = 'price_team_test';
  prismaMock.billingSubscription.findFirst.mockResolvedValue(null);
});

afterEach(() => {
  __setStripeForTest(undefined);
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------

describe('isSupportedEvent', () => {
  it('設計書 §7.5 が列挙するイベントを受け付ける', () => {
    for (const type of [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'customer.subscription.trial_will_end',
      'invoice.paid',
      'invoice.payment_failed',
      'invoice.payment_action_required',
      'invoice.updated',
    ]) {
      expect(isSupportedEvent(type)).toBe(true);
    }
  });

  it('対象外のイベントは受け付けない', () => {
    expect(isSupportedEvent('payment_intent.succeeded')).toBe(false);
    expect(isSupportedEvent('customer.created')).toBe(false);
  });
});

describe('isStaleInvoiceEvent', () => {
  const invoiceEvent = event('invoice.paid', {});

  it('最終反映より古い請求書イベントはスキップ対象', () => {
    expect(isStaleInvoiceEvent(invoiceEvent, new Date('2026-09-02T00:00:00Z'))).toBe(true);
  });

  it('新しい請求書イベントは処理する', () => {
    expect(isStaleInvoiceEvent(invoiceEvent, new Date('2026-08-31T00:00:00Z'))).toBe(false);
  });

  it('まだ何も反映していなければ処理する', () => {
    expect(isStaleInvoiceEvent(invoiceEvent, null)).toBe(false);
  });

  it('契約系イベントには適用しない (現在値を取り直すため)', () => {
    // event.created は秒精度で同一秒内の前後を判別できない。契約系は retrieve で解決する
    const subEvent = event('customer.subscription.updated', {});
    expect(isStaleInvoiceEvent(subEvent, new Date('2026-09-02T00:00:00Z'))).toBe(false);
  });
});

// -----------------------------------------------------------------------------

describe('checkout.session.completed', () => {
  const session = {
    customer: 'cus_9',
    subscription: 'sub_9',
    customer_details: { email: 'Buyer@Example.test' },
    metadata: { organization_id: 'org-1', user_id: 'u-1', plan_code: 'team' },
  };

  it('顧客 ID を確定するが、プランは昇格しない (SR-BILL-03)', async () => {
    const f = fakeTx();

    const outcome = await applyEvent(f.tx, event('checkout.session.completed', session), {});

    expect(outcome).toMatchObject({ status: 'processed', organizationId: 'org-1' });
    expect(f.data()).toMatchObject({ stripeCustomerId: 'cus_9', stripeSubscriptionId: 'sub_9' });
    // success URL への到達や Checkout 完了だけで有料権限を与えてはならない
    expect(f.data()).not.toHaveProperty('planCode');
    expect(f.data()).not.toHaveProperty('status');
    expect(f.actions()).toEqual(['trial_started']);
  });

  it('トライアル利用履歴をメール正規化して記録する', async () => {
    const f = fakeTx();

    await applyEvent(f.tx, event('checkout.session.completed', session), {});

    expect(f.claimCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        userId: 'u-1',
        emailNormalized: 'buyer@example.test',
        emailDomain: 'example.test',
        stripeCustomerId: 'cus_9',
      }),
    });
  });

  it('未解除の履歴が既にあれば二重に記録しない', async () => {
    const f = fakeTx();
    f.raw.billingTrialClaim.findFirst = vi.fn(async () => ({ id: 'claim-1' })) as never;

    await applyEvent(f.tx, event('checkout.session.completed', session), {});

    expect(f.claimCreate).not.toHaveBeenCalled();
  });

  it('組織が特定できないセッションはスキップする', async () => {
    const f = fakeTx();

    const outcome = await applyEvent(
      f.tx,
      event('checkout.session.completed', { ...session, metadata: {} }),
      {},
    );

    expect(outcome).toEqual({ status: 'skipped', organizationId: null });
    expect(f.update).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------

describe('customer.subscription.*', () => {
  function snapshot(over: Record<string, unknown> = {}) {
    return {
      organizationId: 'org-1',
      planCode: 'team' as const,
      status: 'active' as const,
      stripeSubscriptionId: 'sub_9',
      stripeCustomerId: 'cus_9',
      stripePriceId: 'price_team_test',
      currentPeriodStart: new Date('2026-09-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialStart: null,
      trialEnd: null,
      ...over,
    };
  }

  it('有効な契約はプランと期間を反映し、猶予をクリアする', async () => {
    const f = fakeTx(row({ gracePeriodEndsAt: new Date('2026-09-08T00:00:00Z') }));

    const outcome = await applyEvent(
      f.tx,
      event('customer.subscription.updated', {}),
      { snapshot: snapshot() },
    );

    expect(outcome.status).toBe('processed');
    expect(f.data()).toMatchObject({
      planCode: 'team',
      status: 'active',
      gracePeriodEndsAt: null,
      lastPaymentFailedAt: null,
    });
    expect(f.actions()).toEqual(['subscription_updated']);
  });

  it('未確定の契約ではプランを上げない', async () => {
    const f = fakeTx(row({ planCode: 'free' }));

    await applyEvent(f.tx, event('customer.subscription.updated', {}), {
      snapshot: snapshot({ status: 'incomplete' }),
    });

    // incomplete のまま Team 権限を与えない
    expect(f.data()).toMatchObject({ planCode: 'free', status: 'incomplete' });
  });

  it('保留中のプラン変更は、契約が有効になった時点で確定する (FR-BILL-07)', async () => {
    const f = fakeTx(row({ planCode: 'personal', pendingPlanCode: 'team' }));

    await applyEvent(f.tx, event('customer.subscription.updated', {}), {
      snapshot: snapshot(),
    });

    expect(f.data()).toMatchObject({
      planCode: 'team',
      pendingPlanCode: null,
      pendingPlanEffectiveAt: null,
    });
    expect(f.actions()).toEqual(['subscription_updated', 'plan_changed']);
  });

  it('保留中でも契約が有効でなければ確定しない', async () => {
    const f = fakeTx(row({ planCode: 'personal', pendingPlanCode: 'team' }));

    await applyEvent(f.tx, event('customer.subscription.updated', {}), {
      snapshot: snapshot({ status: 'past_due' }),
    });

    expect(f.data()).toMatchObject({ planCode: 'personal' });
    expect(f.data()).not.toHaveProperty('pendingPlanCode');
    expect(f.actions()).toEqual(['subscription_updated']);
  });

  it('作成イベントは subscription_created として記録する', async () => {
    const f = fakeTx();

    await applyEvent(f.tx, event('customer.subscription.created', {}), {
      snapshot: snapshot(),
    });

    expect(f.actions()).toEqual(['subscription_created']);
  });

  it('トライアル開始日は最初の値を保つ', async () => {
    const first = new Date('2026-08-01T00:00:00Z');
    const f = fakeTx(row({ trialUsedAt: first }));

    await applyEvent(f.tx, event('customer.subscription.updated', {}), {
      snapshot: snapshot({ trialStart: new Date('2026-09-01T00:00:00Z') }),
    });

    expect(f.data().trialUsedAt).toEqual(first);
  });

  it('解約はプランを据え置いたまま canceled にし、解約完了メールを促す', async () => {
    const f = fakeTx(row({ planCode: 'team', status: 'active' }));

    const outcome = await applyEvent(f.tx, event('customer.subscription.deleted', {}), {
      snapshot: snapshot({ status: 'canceled' }),
    });

    // プランは消さない。実効プランへの降格は entitlement 側が status から導く
    expect(f.data()).toMatchObject({ planCode: 'team', status: 'canceled' });
    expect(f.actions()).toEqual(['subscription_canceled']);
    expect(outcome.notification).toEqual({
      type: 'subscription_canceled',
      organizationId: 'org-1',
    });
  });

  it('組織を特定できなければ何も書かない', async () => {
    const f = fakeTx();

    const outcome = await applyEvent(f.tx, event('customer.subscription.updated', {}), {
      snapshot: null,
    });

    expect(outcome).toEqual({ status: 'skipped', organizationId: null });
    expect(f.update).not.toHaveBeenCalled();
  });

  it('契約行が無ければ何も書かない', async () => {
    const f = fakeTx(null);

    const outcome = await applyEvent(f.tx, event('customer.subscription.updated', {}), {
      snapshot: snapshot(),
    });

    expect(outcome).toEqual({ status: 'skipped', organizationId: null });
    expect(f.update).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------

describe('invoice.*', () => {
  const invoice = { id: 'in_1', customer: 'cus_1' };

  it('支払い成功で active に戻し、猶予をクリアする', async () => {
    const f = fakeTx(row({ status: 'past_due', gracePeriodEndsAt: new Date() }));

    const outcome = await applyEvent(f.tx, event('invoice.paid', invoice), {});

    expect(outcome).toMatchObject({ status: 'processed', organizationId: 'org-1' });
    expect(f.data()).toMatchObject({
      status: 'active',
      latestInvoiceId: 'in_1',
      gracePeriodEndsAt: null,
      lastPaymentFailedAt: null,
    });
    expect(f.actions()).toEqual(['payment_recovered']);
  });

  it('支払い成功は保留中のプラン変更の確定点になる (Personal → Team の追加請求)', async () => {
    const f = fakeTx(row({ planCode: 'personal', pendingPlanCode: 'team' }));

    await applyEvent(f.tx, event('invoice.paid', invoice), {});

    expect(f.data()).toMatchObject({ planCode: 'team', pendingPlanCode: null });
    expect(f.actions()).toEqual(['payment_recovered', 'plan_changed']);
  });

  it('支払い失敗で past_due にし、初回失敗から 7 日の猶予を置く', async () => {
    const f = fakeTx();

    const outcome = await applyEvent(f.tx, event('invoice.payment_failed', invoice), {});

    const graceEndsAt = new Date('2026-09-08T00:00:00Z');
    expect(f.data()).toMatchObject({ status: 'past_due', gracePeriodEndsAt: graceEndsAt });
    expect(f.actions()).toEqual(['payment_failed']);
    expect(outcome.notification).toEqual({
      type: 'payment_failed',
      organizationId: 'org-1',
      graceEndsAt,
    });
  });

  it('再試行のたびに猶予を延ばさない (§7.10.2)', async () => {
    const first = new Date('2026-09-03T00:00:00Z');
    const f = fakeTx(row({ status: 'past_due', gracePeriodEndsAt: first }));

    await applyEvent(f.tx, event('invoice.payment_failed', invoice), {});

    expect(f.data().gracePeriodEndsAt).toEqual(first);
  });

  it('追加認証が必要な場合も past_due とし、Portal へ誘導する', async () => {
    const f = fakeTx();

    const outcome = await applyEvent(
      f.tx,
      event('invoice.payment_action_required', invoice),
      {},
    );

    expect(f.data()).toMatchObject({ status: 'past_due' });
    expect(outcome.notification).toEqual({
      type: 'payment_action_required',
      organizationId: 'org-1',
    });
  });

  it('invoice.updated は請求書 ID だけを更新し、状態を触らない', async () => {
    const f = fakeTx(row({ status: 'past_due' }));

    await applyEvent(f.tx, event('invoice.updated', invoice), {});

    expect(f.data()).toMatchObject({ latestInvoiceId: 'in_1' });
    expect(f.data()).not.toHaveProperty('status');
  });

  it('顧客で引けない場合は契約 ID で引く', async () => {
    const f = fakeTx();
    f.raw.billingSubscription.findUnique = vi.fn(
      async ({ where }: { where: { stripeCustomerId?: string; stripeSubscriptionId?: string } }) =>
        where.stripeSubscriptionId ? row() : null,
    ) as never;

    const outcome = await applyEvent(
      f.tx,
      event('invoice.paid', { id: 'in_1', customer: null, subscription: 'sub_9' }),
      {},
    );

    expect(outcome.organizationId).toBe('org-1');
  });

  it('契約を特定できなければ何も書かない', async () => {
    const f = fakeTx();
    f.raw.billingSubscription.findUnique = vi.fn(async () => null) as never;

    const outcome = await applyEvent(
      f.tx,
      event('invoice.paid', { id: 'in_1', customer: null }),
      {},
    );

    expect(outcome).toEqual({ status: 'skipped', organizationId: null });
    expect(f.update).not.toHaveBeenCalled();
  });
});

describe('customer.subscription.trial_will_end', () => {
  it('通知だけを返し、契約状態は変えない', async () => {
    const f = fakeTx();
    const trialEnd = Math.floor(new Date('2026-09-06T00:00:00Z').getTime() / 1000);

    const outcome = await applyEvent(
      f.tx,
      event('customer.subscription.trial_will_end', {
        metadata: { organization_id: 'org-1' },
        trial_end: trialEnd,
      }),
      {},
    );

    expect(f.update).not.toHaveBeenCalled();
    expect(outcome.notification).toEqual({
      type: 'trial_will_end',
      organizationId: 'org-1',
      trialEnd: new Date('2026-09-06T00:00:00Z'),
    });
  });

  it('metadata が無ければ顧客 ID から組織を引く', async () => {
    const f = fakeTx();

    const outcome = await applyEvent(
      f.tx,
      event('customer.subscription.trial_will_end', { customer: 'cus_1', trial_end: null }),
      {},
    );

    expect(outcome.organizationId).toBe('org-1');
  });
});

describe('未対応イベント', () => {
  it('スキップとして扱う', async () => {
    const f = fakeTx();

    const outcome = await applyEvent(f.tx, event('payment_intent.succeeded', {}), {});

    expect(outcome).toEqual({ status: 'skipped', organizationId: null });
  });
});

// -----------------------------------------------------------------------------

describe('prefetchSubscription', () => {
  function stubStripe(subscription: unknown, retrieve = vi.fn(async () => subscription)) {
    __setStripeForTest({ subscriptions: { retrieve } } as never);
    return retrieve;
  }

  const payload = {
    id: 'sub_9',
    status: 'incomplete',
    customer: 'cus_9',
    metadata: { organization_id: 'org-1' },
    items: { data: [{ price: { id: 'price_team_test' } }] },
  };

  it('受信ペイロードではなく Stripe の現在値を使う (順序逆転への耐性)', async () => {
    const retrieve = stubStripe({
      ...payload,
      status: 'active',
      items: {
        data: [
          {
            price: { id: 'price_team_test' },
            current_period_end: Math.floor(new Date('2026-10-01T00:00:00Z').getTime() / 1000),
          },
        ],
      },
    });

    const snapshot = await prefetchSubscription(
      event('customer.subscription.updated', payload),
    );

    expect(retrieve).toHaveBeenCalledWith('sub_9');
    // ペイロードの incomplete ではなく、取り直した active を採用する
    expect(snapshot).toMatchObject({
      organizationId: 'org-1',
      planCode: 'team',
      status: 'active',
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
    });
  });

  it('Price ID からプランを判定する (ID は環境変数のみで管理する)', async () => {
    stubStripe({
      ...payload,
      status: 'active',
      items: { data: [{ price: { id: 'price_personal_test' } }] },
    });

    const snapshot = await prefetchSubscription(event('customer.subscription.updated', payload));

    expect(snapshot?.planCode).toBe('personal');
  });

  it('見覚えのない Price は free として扱う', async () => {
    stubStripe({
      ...payload,
      status: 'active',
      items: { data: [{ price: { id: 'price_unknown' } }] },
    });

    const snapshot = await prefetchSubscription(event('customer.subscription.updated', payload));

    expect(snapshot?.planCode).toBe('free');
  });

  it('請求期間が契約直下にある API バージョンでも読める', async () => {
    stubStripe({
      ...payload,
      status: 'active',
      current_period_end: Math.floor(new Date('2026-11-01T00:00:00Z').getTime() / 1000),
      items: { data: [{ price: { id: 'price_team_test' } }] },
    });

    const snapshot = await prefetchSubscription(event('customer.subscription.updated', payload));

    expect(snapshot?.currentPeriodEnd).toEqual(new Date('2026-11-01T00:00:00Z'));
  });

  it('取得に失敗したら受信ペイロードで代替する', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubStripe(
      null,
      vi.fn(async () => {
        throw new Error('network');
      }),
    );

    const snapshot = await prefetchSubscription(event('customer.subscription.updated', payload));

    expect(snapshot).toMatchObject({ status: 'incomplete', planCode: 'team' });
    consoleWarn.mockRestore();
  });

  it('削除イベントは canceled に正規化する', async () => {
    stubStripe({ ...payload, status: 'active' });

    const snapshot = await prefetchSubscription(event('customer.subscription.deleted', payload));

    expect(snapshot?.status).toBe('canceled');
  });

  it('Stripe が知らない状態は none に落とす', async () => {
    stubStripe({ ...payload, status: 'future_status' });

    const snapshot = await prefetchSubscription(event('customer.subscription.updated', payload));

    expect(snapshot?.status).toBe('none');
  });

  it('metadata が無ければ顧客・契約 ID から組織を引く', async () => {
    stubStripe({ ...payload, metadata: {}, status: 'active' });
    prismaMock.billingSubscription.findFirst.mockResolvedValue({ organizationId: 'org-2' });

    const snapshot = await prefetchSubscription(event('customer.subscription.updated', payload));

    expect(snapshot?.organizationId).toBe('org-2');
  });

  it('組織を特定できなければ null を返す', async () => {
    stubStripe({ ...payload, metadata: {}, status: 'active' });

    expect(await prefetchSubscription(event('customer.subscription.updated', payload))).toBeNull();
  });

  it('契約系以外のイベントでは Stripe を呼ばない', async () => {
    const retrieve = stubStripe(payload);

    expect(await prefetchSubscription(event('invoice.paid', {}))).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
  });
});
