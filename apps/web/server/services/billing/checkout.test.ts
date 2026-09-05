import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiException } from '../../lib/errors.js';
import { createCheckoutSession, createPortalSession } from './checkout.js';
import { __setStripeForTest } from './stripeClient.js';

// =============================================================================
// Checkout / Customer Portal (設計書 §7.4 / §7.8)
// 実 Stripe には接続せず、送信するパラメータそのものを固定する。
// =============================================================================

const prismaMock = vi.hoisted(() => ({
  billingSubscription: { findUnique: vi.fn() },
  user: { findUniqueOrThrow: vi.fn() },
  billingTrialClaim: { findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

const envState: Record<string, unknown> = {};
vi.mock('../../lib/env.js', () => ({ getServerEnv: () => envState }));

const setEnv = (patch: Record<string, unknown>) => {
  for (const k of Object.keys(envState)) delete envState[k];
  Object.assign(envState, patch);
};

const FULL_ENV = {
  STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_personal',
  STRIPE_TEAM_MONTHLY_PRICE_ID: 'price_team',
  STRIPE_JP_TAX_RATE_ID: 'txr_jp',
  STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_1',
};

const checkoutCreate = vi.fn();
const portalCreate = vi.fn();

function stubStripe() {
  __setStripeForTest({
    checkout: { sessions: { create: checkoutCreate } },
    billingPortal: { sessions: { create: portalCreate } },
  } as never);
}

const input = {
  organizationId: 'org-1',
  userId: 'u-1',
  planCode: 'team' as const,
  origin: 'https://app.trakon.test',
};

type CheckoutParams = {
  line_items: unknown;
  automatic_tax: unknown;
  payment_method_collection: string;
  success_url: string;
  cancel_url: string;
  metadata: Record<string, string>;
  subscription_data: Record<string, unknown>;
  customer?: string;
  customer_email?: string;
};

/** createCheckoutSession に渡された Stripe パラメータ。 */
function params(): CheckoutParams {
  const call = checkoutCreate.mock.calls.at(-1);
  if (!call) throw new Error('Checkout セッションが作られていない');
  return call[0] as CheckoutParams;
}

beforeEach(() => {
  setEnv(FULL_ENV);
  stubStripe();
  checkoutCreate.mockReset().mockResolvedValue({ url: 'https://checkout.stripe.test/s' });
  portalCreate.mockReset().mockResolvedValue({ url: 'https://portal.stripe.test/s' });
  prismaMock.billingSubscription.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.user.findUniqueOrThrow.mockReset().mockResolvedValue({ email: 'owner@example.test' });
  prismaMock.billingTrialClaim.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.auditLog.create.mockReset().mockResolvedValue({});
});

afterEach(() => {
  __setStripeForTest(undefined);
});

describe('createCheckoutSession', () => {
  describe('確定要件', () => {
    it('quantity は常に 1 (人数課金は行わない)', async () => {
      await createCheckoutSession(input);

      expect(params().line_items).toEqual([{ price: 'price_team', quantity: 1 }]);
    });

    it('自動税計算は使わず、税込 Price + 手動 Tax Rate で組む', async () => {
      await createCheckoutSession(input);

      expect(params().automatic_tax).toEqual({ enabled: false });
      expect(params().subscription_data.default_tax_rates).toEqual(['txr_jp']);
    });

    it('トライアルは trial_period_days で渡す (trial_end は使わない)', async () => {
      await createCheckoutSession(input);

      // trial_end だと Session 作成〜申込完了の時間差だけトライアルが短くなる
      expect(params().subscription_data.trial_period_days).toBe(5);
      expect(params().subscription_data).not.toHaveProperty('trial_end');
    });

    it('トライアル中でもカード登録を必須にする', async () => {
      await createCheckoutSession(input);

      expect(params().payment_method_collection).toBe('always');
    });

    it('復帰後に反映待ちを出せるよう success/cancel URL を渡す', async () => {
      await createCheckoutSession(input);

      expect(params().success_url).toBe(
        'https://app.trakon.test/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      );
      expect(params().cancel_url).toBe('https://app.trakon.test/settings/billing?checkout=canceled');
    });
  });

  describe('metadata', () => {
    it('Webhook から組織を引けるよう metadata を積む', async () => {
      await createCheckoutSession(input);

      expect(params().metadata).toMatchObject({
        user_id: 'u-1',
        organization_id: 'org-1',
        plan_code: 'team',
        email: 'owner@example.test',
      });
      // subscription 側にも同じものを載せる (契約系イベントで参照するため)
      expect(params().subscription_data.metadata).toEqual(params().metadata);
    });
  });

  describe('顧客の扱い', () => {
    it('既存の顧客があれば再利用する', async () => {
      prismaMock.billingSubscription.findUnique.mockResolvedValue({
        stripeCustomerId: 'cus_1',
        status: 'canceled',
        stripeSubscriptionId: 'sub_1',
      });

      await createCheckoutSession(input);

      expect(params().customer).toBe('cus_1');
      expect(params()).not.toHaveProperty('customer_email');
    });

    it('顧客がなければメールアドレスを渡す', async () => {
      await createCheckoutSession(input);

      expect(params().customer_email).toBe('owner@example.test');
      expect(params()).not.toHaveProperty('customer');
    });
  });

  describe('トライアル重複', () => {
    it('履歴があればトライアルを付けずに申し込ませる', async () => {
      prismaMock.billingTrialClaim.findFirst.mockResolvedValue({
        userId: 'u-1',
        emailNormalized: 'owner@example.test',
        organizationId: 'org-1',
        stripeCustomerId: null,
      });

      const result = await createCheckoutSession(input);

      expect(result.trialApplied).toBe(false);
      expect(params().subscription_data).not.toHaveProperty('trial_period_days');
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'trial_blocked' }),
        }),
      );
    });

    it('付与できるときは checkout_started として記録する', async () => {
      const result = await createCheckoutSession(input);

      expect(result.trialApplied).toBe(true);
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'checkout_started', resourceId: 'org-1' }),
        }),
      );
    });
  });

  describe('異常系', () => {
    it('既に有効な契約があれば 409 (プラン変更へ誘導する)', async () => {
      prismaMock.billingSubscription.findUnique.mockResolvedValue({
        stripeSubscriptionId: 'sub_1',
        status: 'active',
        stripeCustomerId: 'cus_1',
      });

      await expect(createCheckoutSession(input)).rejects.toMatchObject({
        code: 'SUBSCRIPTION_ALREADY_ACTIVE',
        status: 409,
      });
      expect(checkoutCreate).not.toHaveBeenCalled();
    });

    it('Price ID が未設定なら 503 BILLING_NOT_CONFIGURED', async () => {
      setEnv({});

      await expect(createCheckoutSession(input)).rejects.toMatchObject({
        code: 'BILLING_NOT_CONFIGURED',
        status: 503,
      });
    });

    it('Stripe が URL を返さなければ 502', async () => {
      checkoutCreate.mockResolvedValue({ url: null });

      await expect(createCheckoutSession(input)).rejects.toBeInstanceOf(ApiException);
      // 監査ログも書かない (申し込みは成立していない)
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });
  });
});

describe('createPortalSession', () => {
  it('構成 ID を明示指定する (ダッシュボードの既定に依存しない)', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_1' });

    const result = await createPortalSession({
      organizationId: 'org-1',
      origin: 'https://app.trakon.test',
    });

    // 構成側でプラン変更を無効化しているため、既定任せにしてはならない
    expect(portalCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://app.trakon.test/settings/billing',
      configuration: 'bpc_1',
    });
    expect(result.url).toBe('https://portal.stripe.test/s');
  });

  it('構成 ID が未設定なら渡さない', async () => {
    setEnv({});
    prismaMock.billingSubscription.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_1' });

    await createPortalSession({ organizationId: 'org-1', origin: 'https://app.trakon.test' });

    expect(portalCreate.mock.calls[0]![0]).not.toHaveProperty('configuration');
  });

  it('顧客が未登録なら 409 (先に申し込みへ誘導する)', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue(null);

    await expect(
      createPortalSession({ organizationId: 'org-1', origin: 'https://app.trakon.test' }),
    ).rejects.toMatchObject({ code: 'NO_STRIPE_CUSTOMER', status: 409 });
  });
});
