import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileSubscription } from './reconcile.js';
import { __setStripeForTest } from './stripeClient.js';

// =============================================================================
// 契約状態の照合 (#209)
//
// 実 Stripe には接続せず、「どの手がかりから契約を辿り、何を DB へ書くか」を固定する。
// =============================================================================

const txMock = vi.hoisted(() => ({
  billingSubscription: { update: vi.fn() },
  auditLog: { create: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  billingSubscription: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

const sessionRetrieve = vi.fn();
const subscriptionRetrieve = vi.fn();
const subscriptionList = vi.fn();

const ORG_ID = 'org-1';

/** Stripe が返す契約 (Personal / トライアル中)。 */
const STRIPE_SUBSCRIPTION = {
  id: 'sub_1',
  customer: 'cus_1',
  status: 'trialing',
  cancel_at_period_end: false,
  canceled_at: null,
  trial_start: 1_780_000_000,
  trial_end: 1_780_432_000,
  items: {
    data: [
      {
        price: { id: 'price_personal' },
        current_period_start: 1_780_000_000,
        current_period_end: 1_782_592_000,
      },
    ],
  },
  default_payment_method: { card: { brand: 'visa', last4: '4242' } },
};

/** DB 上の現在値 (まだ Free)。 */
const FREE_ROW = {
  organizationId: ORG_ID,
  planCode: 'free',
  status: 'none',
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  pendingPlanCode: null,
  trialUsedAt: null,
};

beforeEach(() => {
  process.env.STRIPE_PERSONAL_MONTHLY_PRICE_ID = 'price_personal';
  process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = 'price_team';

  __setStripeForTest({
    checkout: { sessions: { retrieve: sessionRetrieve } },
    subscriptions: { retrieve: subscriptionRetrieve, list: subscriptionList },
  } as never);

  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(txMock),
  );
  subscriptionRetrieve.mockResolvedValue(STRIPE_SUBSCRIPTION);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('reconcileSubscription', () => {
  it('Checkout Session から契約を辿って反映する', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue(FREE_ROW);
    sessionRetrieve.mockResolvedValue({
      id: 'cs_1',
      subscription: 'sub_1',
      customer: 'cus_1',
      metadata: { organization_id: ORG_ID },
    });

    const result = await reconcileSubscription({
      organizationId: ORG_ID,
      checkoutSessionId: 'cs_1',
    });

    expect(result).toEqual({ synced: true });
    // 受信ペイロードではなく Stripe API から取り直した値を使う
    expect(subscriptionRetrieve).toHaveBeenCalledWith('sub_1', {
      expand: ['default_payment_method'],
    });

    const written = txMock.billingSubscription.update.mock.calls[0]![0].data;
    expect(written.planCode).toBe('personal');
    expect(written.status).toBe('trialing');
    expect(written.stripeSubscriptionId).toBe('sub_1');
    expect(written.defaultPaymentMethodLast4).toBe('4242');
    // Webhook の処理位置 (lastStripeEvent*) は照合では動かさない
    expect(written.lastStripeEventId).toBeUndefined();
    expect(written.lastStripeEventAt).toBeUndefined();
  });

  it('他組織の Checkout Session は拒否する', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue(FREE_ROW);
    sessionRetrieve.mockResolvedValue({
      id: 'cs_other',
      subscription: 'sub_other',
      customer: 'cus_other',
      metadata: { organization_id: 'org-someone-else' },
    });

    const result = await reconcileSubscription({
      organizationId: ORG_ID,
      checkoutSessionId: 'cs_other',
    });

    expect(result).toEqual({ synced: false, reason: 'session_mismatch' });
    expect(subscriptionRetrieve).not.toHaveBeenCalled();
    expect(txMock.billingSubscription.update).not.toHaveBeenCalled();
  });

  it('Session が無くても保存済みの契約 ID から取り直せる', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      ...FREE_ROW,
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });

    const result = await reconcileSubscription({ organizationId: ORG_ID });

    expect(result).toEqual({ synced: true });
    expect(sessionRetrieve).not.toHaveBeenCalled();
    expect(subscriptionRetrieve).toHaveBeenCalledWith('sub_1', expect.anything());
  });

  it('契約 ID が無ければ顧客から最新の契約を引く', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      ...FREE_ROW,
      stripeCustomerId: 'cus_1',
    });
    subscriptionList.mockResolvedValue({ data: [{ id: 'sub_1' }] });

    const result = await reconcileSubscription({ organizationId: ORG_ID });

    expect(result).toEqual({ synced: true });
    expect(subscriptionList).toHaveBeenCalledWith({
      customer: 'cus_1',
      status: 'all',
      limit: 1,
    });
  });

  it('契約がまだ無ければ何も書かない', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue(FREE_ROW);

    const result = await reconcileSubscription({ organizationId: ORG_ID });

    expect(result).toEqual({ synced: false, reason: 'no_subscription' });
    expect(txMock.billingSubscription.update).not.toHaveBeenCalled();
  });

  it('Stripe が落ちていても例外を投げずに理由を返す', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      ...FREE_ROW,
      stripeSubscriptionId: 'sub_1',
    });
    subscriptionRetrieve.mockRejectedValue(new Error('network'));

    const result = await reconcileSubscription({ organizationId: ORG_ID });

    expect(result).toEqual({ synced: false, reason: 'stripe_error' });
  });

  it('保留中のプラン変更は契約が有効になった時点で確定する', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      ...FREE_ROW,
      planCode: 'personal',
      stripeSubscriptionId: 'sub_1',
      pendingPlanCode: 'team',
    });
    subscriptionRetrieve.mockResolvedValue({
      ...STRIPE_SUBSCRIPTION,
      status: 'active',
      items: { data: [{ price: { id: 'price_team' } }] },
    });

    await reconcileSubscription({ organizationId: ORG_ID });

    const written = txMock.billingSubscription.update.mock.calls[0]![0].data;
    expect(written.planCode).toBe('team');
    expect(written.pendingPlanCode).toBeNull();
  });
});
