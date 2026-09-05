import { prisma } from '@trakon/db';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __setStripeForTest } from '../../services/billing/stripeClient.js';
import {
  createOrgMember,
  createProject,
  createUser,
  primaryOrganizationId,
  setBillingSubscription,
} from '../../test/factories.js';
import { signTestJwt } from '../../test/auth.js';
import { TEST_STRIPE } from '../../test/integration.setup.js';
import { api } from '../../test/request.js';

// =============================================================================
// Checkout / Portal / プラン変更 / 解約 (設計書 §7.4 / §7.7 / §7.8)
//
// Stripe SDK はモックする。CI から実 Stripe へは接続しない。
// =============================================================================

const checkoutCreate = vi.fn();
const portalCreate = vi.fn();
const subscriptionsRetrieve = vi.fn();
const subscriptionsUpdate = vi.fn();
const scheduleCreate = vi.fn();
const scheduleUpdate = vi.fn();

function stubStripe() {
  __setStripeForTest({
    checkout: { sessions: { create: checkoutCreate } },
    billingPortal: { sessions: { create: portalCreate } },
    subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
    subscriptionSchedules: { create: scheduleCreate, update: scheduleUpdate },
  } as unknown as Stripe);
}

let ownerToken: string;
let organizationId: string;
let ownerUserId: string;

// Stripe の env は integration.setup.ts で設定済み (getServerEnv() のキャッシュ対策)。
beforeEach(async () => {
  vi.clearAllMocks();
  checkoutCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
  portalCreate.mockResolvedValue({ url: 'https://portal.stripe.test/ps_1' });
  subscriptionsRetrieve.mockResolvedValue({
    id: 'sub_1',
    items: { data: [{ id: 'si_1', price: { id: TEST_STRIPE.teamPriceId }, current_period_end: 1_762_000_000 }] },
  });
  subscriptionsUpdate.mockResolvedValue({
    id: 'sub_1',
    items: { data: [{ id: 'si_1', current_period_end: 1_762_000_000 }] },
  });
  scheduleCreate.mockResolvedValue({ id: 'sub_sched_1', current_phase: { start_date: 1_760_000_000 } });
  scheduleUpdate.mockResolvedValue({ id: 'sub_sched_1' });
  stubStripe();

  const owner = await createUser();
  ownerUserId = owner.id;
  organizationId = await primaryOrganizationId(owner.id);
  ownerToken = await signTestJwt({ authUserId: owner.authUserId, email: owner.email });
});

afterEach(() => {
  __setStripeForTest(undefined);
});

describe('GET /billing/subscription', () => {
  describe('正常系', () => {
    it('Free の契約状態と上限・利用状況を返す', async () => {
      await createProject({ createdBy: ownerUserId });

      const res = await api<{
        data: {
          subscription: { planCode: string; status: string };
          entitlement: { level: string; limits: { projectLimit: number }; usage: { projectCount: number } };
          frozenProjectIds: string[];
          orgRole: string;
        };
      }>('/api/v1/billing/subscription', { token: ownerToken });

      expect(res.status).toBe(200);
      expect(res.body.data.subscription).toMatchObject({ planCode: 'free', status: 'none' });
      expect(res.body.data.entitlement.limits.projectLimit).toBe(2);
      expect(res.body.data.entitlement.usage.projectCount).toBe(1);
      expect(res.body.data.frozenProjectIds).toEqual([]);
      expect(res.body.data.orgRole).toBe('owner');
    });

    it('上限超過分が凍結として返る', async () => {
      await createProject({ createdBy: ownerUserId });
      await createProject({ createdBy: ownerUserId });
      const third = await createProject({ createdBy: ownerUserId });

      const res = await api<{ data: { frozenProjectIds: string[] } }>(
        '/api/v1/billing/subscription',
        { token: ownerToken },
      );

      expect(res.body.data.frozenProjectIds).toEqual([third.id]);
    });

    it('組織メンバー (非管理者) も閲覧できる', async () => {
      const member = await createUser({ withOrganization: false });
      await createOrgMember({ organizationId, userId: member.id, isPrimary: true });
      const token = await signTestJwt({ authUserId: member.authUserId, email: member.email });

      const res = await api('/api/v1/billing/subscription', { token });

      expect(res.status).toBe(200);
    });
  });
});

describe('POST /billing/checkout-session', () => {
  describe('正常系', () => {
    it('トライアル付きの Checkout を作り URL を返す', async () => {
      const res = await api<{ data: { url: string; trialApplied: boolean } }>(
        '/api/v1/billing/checkout-session',
        { method: 'POST', token: ownerToken, body: { planCode: 'team' } },
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        url: 'https://checkout.stripe.test/cs_1',
        trialApplied: true,
      });

      const params = checkoutCreate.mock.calls[0]?.[0];
      expect(params).toMatchObject({
        mode: 'subscription',
        // quantity は常に 1 (人数課金しない)
        line_items: [{ price: TEST_STRIPE.teamPriceId, quantity: 1 }],
        automatic_tax: { enabled: false },
        payment_method_collection: 'always',
      });
      // trial_end は使わない (§7.4.1)
      expect(params.subscription_data).toMatchObject({
        trial_period_days: 5,
        default_tax_rates: [TEST_STRIPE.taxRateId],
      });
      expect(params.subscription_data.trial_end).toBeUndefined();
      expect(params.metadata).toMatchObject({
        organization_id: organizationId,
        user_id: ownerUserId,
        plan_code: 'team',
      });
      expect(params.success_url).toContain('/settings/billing?checkout=success');

      expect(await prisma.auditLog.count({ where: { action: 'checkout_started' } })).toBe(1);
    });

    it('トライアル済みなら trial_period_days を付けず trial_blocked を記録する', async () => {
      await prisma.billingTrialClaim.create({
        data: {
          organizationId,
          userId: ownerUserId,
          emailNormalized: 'x@example.test',
          emailDomain: 'example.test',
        },
      });

      const res = await api<{ data: { trialApplied: boolean } }>(
        '/api/v1/billing/checkout-session',
        { method: 'POST', token: ownerToken, body: { planCode: 'personal' } },
      );

      expect(res.body.data.trialApplied).toBe(false);
      expect(checkoutCreate.mock.calls[0]?.[0].subscription_data.trial_period_days).toBeUndefined();
      expect(await prisma.auditLog.count({ where: { action: 'trial_blocked' } })).toBe(1);
    });

    it('既存の顧客 ID があれば再利用する', async () => {
      await setBillingSubscription({ organizationId, stripeCustomerId: 'cus_existing' });

      await api('/api/v1/billing/checkout-session', {
        method: 'POST',
        token: ownerToken,
        body: { planCode: 'team' },
      });

      expect(checkoutCreate.mock.calls[0]?.[0].customer).toBe('cus_existing');
    });
  });

  describe('異常系', () => {
    it('既に有効な契約があれば 409', async () => {
      await setBillingSubscription({
        organizationId,
        status: 'active',
        planCode: 'team',
        stripeSubscriptionId: 'sub_1',
      });

      const res = await api<{ error: { code: string } }>('/api/v1/billing/checkout-session', {
        method: 'POST',
        token: ownerToken,
        body: { planCode: 'team' },
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SUBSCRIPTION_ALREADY_ACTIVE');
    });

    it('組織メンバー (非管理者) は 403', async () => {
      const member = await createUser({ withOrganization: false });
      await createOrgMember({ organizationId, userId: member.id, isPrimary: true });
      const token = await signTestJwt({ authUserId: member.authUserId, email: member.email });

      const res = await api<{ error: { code: string } }>('/api/v1/billing/checkout-session', {
        method: 'POST',
        token,
        body: { planCode: 'team' },
      });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});

describe('POST /billing/portal-session', () => {
  it('顧客がいれば都度セッションを生成する (URL は保存しない)', async () => {
    await setBillingSubscription({ organizationId, stripeCustomerId: 'cus_1' });

    const res = await api<{ data: { url: string } }>('/api/v1/billing/portal-session', {
      method: 'POST',
      token: ownerToken,
    });

    expect(res.body.data.url).toBe('https://portal.stripe.test/ps_1');
    // プラン変更を無効化した構成を明示指定する
    expect(portalCreate.mock.calls[0]?.[0]).toMatchObject({ configuration: TEST_STRIPE.portalConfigurationId });
    // URL は DB に残さない
    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(JSON.stringify(sub)).not.toContain('portal.stripe.test');
  });

  it('顧客が未作成なら 409', async () => {
    const res = await api<{ error: { code: string } }>('/api/v1/billing/portal-session', {
      method: 'POST',
      token: ownerToken,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_STRIPE_CUSTOMER');
  });
});

describe('POST /billing/plan — Personal → Team', () => {
  beforeEach(async () => {
    await setBillingSubscription({
      organizationId,
      planCode: 'personal',
      status: 'active',
      stripeSubscriptionId: 'sub_1',
    });
  });

  it('即時変更を要求するが、権限は決済成功の確認まで付与しない', async () => {
    const res = await api<{ data: { appliedImmediately: boolean; pendingPlanCode: string } }>(
      '/api/v1/billing/plan',
      { method: 'POST', token: ownerToken, body: { planCode: 'team' } },
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ appliedImmediately: false, pendingPlanCode: 'team' });

    expect(subscriptionsUpdate.mock.calls[0]?.[1]).toMatchObject({
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
    });

    // plan_code はまだ personal のまま
    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.planCode).toBe('personal');
    expect(sub.pendingPlanCode).toBe('team');
  });
});

describe('POST /billing/plan — Team → Personal', () => {
  beforeEach(async () => {
    await setBillingSubscription({
      organizationId,
      planCode: 'team',
      status: 'active',
      stripeSubscriptionId: 'sub_1',
    });
  });

  it('条件を満たせば次回更新時に適用する', async () => {
    const res = await api<{ data: { pendingPlanCode: string } }>('/api/v1/billing/plan', {
      method: 'POST',
      token: ownerToken,
      body: { planCode: 'personal' },
    });

    expect(res.status).toBe(200);
    expect(res.body.data.pendingPlanCode).toBe('personal');
    expect(scheduleCreate).toHaveBeenCalledWith({ from_subscription: 'sub_1' });

    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.planCode).toBe('team');
    expect(sub.pendingPlanCode).toBe('personal');
  });

  it('プロジェクトが上限超過なら 409 で整理対象を返す', async () => {
    for (let i = 0; i < 11; i += 1) {
      await createProject({ createdBy: ownerUserId, name: `P${i}` });
    }

    const res = await api<{
      error: { code: string; details?: { excessProjects: Array<{ id: string }> } };
    }>('/api/v1/billing/plan', {
      method: 'POST',
      token: ownerToken,
      body: { planCode: 'personal' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLAN_DOWNGRADE_BLOCKED');
    expect(res.body.error.details?.excessProjects).toHaveLength(1);
    expect(scheduleCreate).not.toHaveBeenCalled();
  });

  it('会員が上限超過なら 409', async () => {
    const extra = await createUser({ withOrganization: false });
    await createOrgMember({ organizationId, userId: extra.id });

    const res = await api<{ error: { code: string } }>('/api/v1/billing/plan', {
      method: 'POST',
      token: ownerToken,
      body: { planCode: 'personal' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLAN_DOWNGRADE_BLOCKED');
  });
});

describe('POST /billing/cancel と /resume', () => {
  beforeEach(async () => {
    await setBillingSubscription({
      organizationId,
      planCode: 'team',
      status: 'active',
      stripeSubscriptionId: 'sub_1',
    });
  });

  it('解約予約を設定し、プロジェクトは削除しない', async () => {
    const project = await createProject({ createdBy: ownerUserId });

    const res = await api<{ data: { cancelAtPeriodEnd: boolean } }>('/api/v1/billing/cancel', {
      method: 'POST',
      token: ownerToken,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.cancelAtPeriodEnd).toBe(true);
    expect(subscriptionsUpdate.mock.calls[0]?.[1]).toMatchObject({ cancel_at_period_end: true });

    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.cancelAtPeriodEnd).toBe(true);

    // 【確定要件】解約でプロジェクト・メンバーを削除してはならない
    expect(await prisma.project.count({ where: { id: project.id, deletedAt: null } })).toBe(1);
    expect(await prisma.organizationMember.count({ where: { organizationId } })).toBe(1);
  });

  it('解約予約を取り消せる', async () => {
    await api('/api/v1/billing/cancel', { method: 'POST', token: ownerToken });

    const res = await api('/api/v1/billing/resume', { method: 'POST', token: ownerToken });

    expect(res.status).toBe(200);
    const sub = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.cancelAtPeriodEnd).toBe(false);
    expect(sub.canceledAt).toBeNull();
  });
});

describe('認可', () => {
  it('未認証は 401', async () => {
    const res = await api('/api/v1/billing/subscription');
    expect(res.status).toBe(401);
  });
});
