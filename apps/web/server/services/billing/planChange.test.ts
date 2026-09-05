import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelSubscription, changePlan, resumeSubscription } from './planChange.js';
import { __setStripeForTest } from './stripeClient.js';

// =============================================================================
// プラン変更・解約 (設計書 §7.7)
//
// 最重要の不変条件:
//   - Personal → Team は「追加請求の決済成功を Webhook で確認するまで」
//     Team 権限を与えない。ここでは pending にしか書かない
//   - 解約でプロジェクトやメンバーを削除しない
// =============================================================================

const prismaMock = vi.hoisted(() => ({
  billingSubscription: { findUnique: vi.fn(), update: vi.fn() },
  organizationMember: { count: vi.fn() },
  project: { count: vi.fn(), findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

const envState: Record<string, unknown> = {
  STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_personal',
  STRIPE_TEAM_MONTHLY_PRICE_ID: 'price_team',
};
vi.mock('../../lib/env.js', () => ({ getServerEnv: () => envState }));

const retrieve = vi.fn();
const update = vi.fn();
const scheduleCreate = vi.fn();
const scheduleUpdate = vi.fn();

const PERIOD_END = Math.floor(new Date('2026-10-01T00:00:00Z').getTime() / 1000);

function stubStripe() {
  __setStripeForTest({
    subscriptions: { retrieve, update },
    subscriptionSchedules: { create: scheduleCreate, update: scheduleUpdate },
  } as never);
}

/** $transaction([...]) に積まれた prisma 呼び出しの引数を覗く。 */
const txCalls = () => prismaMock.$transaction.mock.calls.at(-1)?.[0] as unknown[];
const subscriptionUpdateData = () =>
  prismaMock.billingSubscription.update.mock.calls.at(-1)?.[0].data as Record<string, unknown>;
const auditData = () =>
  prismaMock.auditLog.create.mock.calls.at(-1)?.[0].data as Record<string, unknown>;

beforeEach(() => {
  stubStripe();
  retrieve.mockReset().mockResolvedValue({
    id: 'sub_1',
    items: { data: [{ id: 'si_1', price: { id: 'price_personal' }, current_period_end: PERIOD_END }] },
  });
  update.mockReset().mockResolvedValue({
    items: { data: [{ id: 'si_1', current_period_end: PERIOD_END }] },
  });
  scheduleCreate.mockReset().mockResolvedValue({ id: 'sub_sched_1', current_phase: { start_date: 1 } });
  scheduleUpdate.mockReset().mockResolvedValue({});
  prismaMock.billingSubscription.findUnique.mockReset().mockResolvedValue({
    organizationId: 'org-1',
    planCode: 'personal',
    stripeSubscriptionId: 'sub_1',
  });
  prismaMock.billingSubscription.update.mockReset().mockReturnValue({});
  prismaMock.auditLog.create.mockReset().mockReturnValue({});
  prismaMock.organizationMember.count.mockReset().mockResolvedValue(1);
  prismaMock.project.count.mockReset().mockResolvedValue(3);
  prismaMock.project.findMany.mockReset().mockResolvedValue([]);
  prismaMock.$transaction.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  __setStripeForTest(undefined);
});

const actor = { organizationId: 'org-1', actorUserId: 'u-1' };

describe('Personal → Team (即時・日割り)', () => {
  it('残期間分を日割り請求し、決済完了まで契約を保留にする', async () => {
    await changePlan({ ...actor, planCode: 'team' });

    expect(update).toHaveBeenCalledWith('sub_1', {
      items: [{ id: 'si_1', price: 'price_team' }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
    });
  });

  it('この時点では Team 権限を与えない (FR-BILL-07)', async () => {
    const result = await changePlan({ ...actor, planCode: 'team' });

    // 昇格は invoice.paid / active な subscription.updated を受けてから
    expect(subscriptionUpdateData()).toEqual({
      pendingPlanCode: 'team',
      pendingPlanEffectiveAt: null,
    });
    expect(subscriptionUpdateData()).not.toHaveProperty('planCode');
    expect(result).toEqual({ appliedImmediately: false, pendingPlanCode: 'team' });
  });

  it('保留であることを監査ログに残す', async () => {
    await changePlan({ ...actor, planCode: 'team' });

    expect(auditData()).toMatchObject({
      action: 'plan_changed',
      resourceId: 'org-1',
      extra: { from: 'personal', to: 'team', pending: true },
    });
  });

  it('契約明細が取れなければ 502', async () => {
    retrieve.mockResolvedValue({ id: 'sub_1', items: { data: [] } });

    await expect(changePlan({ ...actor, planCode: 'team' })).rejects.toMatchObject({
      code: 'SUBSCRIPTION_ITEM_NOT_FOUND',
      status: 502,
    });
  });
});

describe('Team → Personal (次回更新時)', () => {
  beforeEach(() => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      planCode: 'team',
      stripeSubscriptionId: 'sub_1',
    });
    retrieve.mockResolvedValue({
      id: 'sub_1',
      items: { data: [{ id: 'si_1', price: { id: 'price_team' }, current_period_end: PERIOD_END }] },
    });
  });

  it('現行 Price の期間が終わってから Personal に切り替える予約を作る', async () => {
    const result = await changePlan({ ...actor, planCode: 'personal' });

    expect(scheduleCreate).toHaveBeenCalledWith({ from_subscription: 'sub_1' });
    const phases = scheduleUpdate.mock.calls[0]![1].phases;
    expect(phases[0].items).toEqual([{ price: 'price_team', quantity: 1 }]);
    expect(phases[0].end_date).toBe(PERIOD_END);
    expect(phases[1].items).toEqual([{ price: 'price_personal', quantity: 1 }]);
    expect(result).toEqual({ appliedImmediately: false, pendingPlanCode: 'personal' });
  });

  it('適用時刻を保留として記録する', async () => {
    await changePlan({ ...actor, planCode: 'personal' });

    expect(subscriptionUpdateData()).toEqual({
      pendingPlanCode: 'personal',
      pendingPlanEffectiveAt: new Date('2026-10-01T00:00:00Z'),
    });
  });

  it('会員数が Personal の上限を超えていれば受け付けない', async () => {
    prismaMock.organizationMember.count.mockResolvedValue(3);

    await expect(changePlan({ ...actor, planCode: 'personal' })).rejects.toMatchObject({
      code: 'PLAN_DOWNGRADE_BLOCKED',
      status: 409,
      details: { seatCount: 3, seatLimit: 1 },
    });
    expect(scheduleCreate).not.toHaveBeenCalled();
  });

  it('プロジェクト数超過では、整理すべきプロジェクトを添えて返す', async () => {
    prismaMock.project.count.mockResolvedValue(12);
    prismaMock.project.findMany.mockResolvedValue([{ id: 'p-11', name: '超過1' }]);

    await expect(changePlan({ ...actor, planCode: 'personal' })).rejects.toMatchObject({
      code: 'PLAN_DOWNGRADE_BLOCKED',
      details: { projectCount: 12, projectLimit: 10, excessProjects: [{ id: 'p-11' }] },
    });
  });
});

describe('changePlan の前提', () => {
  it('同じプランへの変更は 409', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      planCode: 'team',
      stripeSubscriptionId: 'sub_1',
    });

    await expect(changePlan({ ...actor, planCode: 'team' })).rejects.toMatchObject({
      code: 'PLAN_UNCHANGED',
      status: 409,
    });
  });

  it('Stripe 契約が無ければ 409 (先に申し込みへ誘導する)', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      planCode: 'free',
      stripeSubscriptionId: null,
    });

    await expect(changePlan({ ...actor, planCode: 'team' })).rejects.toMatchObject({
      code: 'NO_ACTIVE_SUBSCRIPTION',
      status: 409,
    });
  });
});

describe('解約', () => {
  it('期間終了時の解約を予約し、支払済み期間は使える', async () => {
    const result = await cancelSubscription(actor);

    expect(update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    expect(subscriptionUpdateData()).toMatchObject({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
    });
    expect(result.cancelAtPeriodEnd).toBe(true);
    expect(result.currentPeriodEnd).toBe('2026-10-01T00:00:00.000Z');
  });

  it('プロジェクトやメンバーを削除しない', async () => {
    await cancelSubscription(actor);

    // 凍結は計算で表現するため、削除処理はコード上に存在しない
    expect(prismaMock.project).not.toHaveProperty('deleteMany');
    const written = JSON.stringify(txCalls());
    expect(written).not.toMatch(/delete/i);
  });

  it('解約を監査ログに残す', async () => {
    await cancelSubscription(actor);

    expect(auditData()).toMatchObject({
      action: 'subscription_canceled',
      extra: { cancelAtPeriodEnd: true },
    });
  });

  it('契約が無ければ 409', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      planCode: 'free',
      stripeSubscriptionId: null,
    });

    await expect(cancelSubscription(actor)).rejects.toMatchObject({
      code: 'NO_ACTIVE_SUBSCRIPTION',
    });
  });
});

describe('解約の取り消し', () => {
  it('期間終了前なら継続できる', async () => {
    const result = await resumeSubscription(actor);

    expect(update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: false });
    expect(subscriptionUpdateData()).toEqual({ cancelAtPeriodEnd: false, canceledAt: null });
    expect(result).toEqual({ cancelAtPeriodEnd: false });
    expect(auditData()).toMatchObject({
      action: 'subscription_updated',
      extra: { cancelAtPeriodEnd: false, resumed: true },
    });
  });
});
