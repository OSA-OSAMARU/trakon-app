import { describe, expect, it } from 'vitest';

import {
  BILLING_PLANS,
  BILLING_PLAN_CODES,
  ORG_ROLES,
  ORG_ROLE_LABEL,
  PAST_DUE_GRACE_DAYS,
  SELECTABLE_BILLING_PLAN_CODES,
  SUBSCRIPTION_STATUSES,
  TRIAL_PERIOD_DAYS,
  TRIAL_PERIOD_HOURS,
  canManageBilling,
  hasLiveSubscription,
} from './billing.js';

describe('課金プラン定義', () => {
  it('全プランコードに仕様が定義されている', () => {
    for (const code of BILLING_PLAN_CODES) {
      expect(BILLING_PLANS[code].code).toBe(code);
      expect(BILLING_PLANS[code].label.length).toBeGreaterThan(0);
    }
  });

  it('上限と金額が事業要件どおり (Stripe 実装仕様書 §2)', () => {
    expect(BILLING_PLANS.free).toMatchObject({
      monthlyPriceJpyIncTax: 0,
      seatLimit: 1,
      projectLimit: 2,
      trialHours: null,
    });
    expect(BILLING_PLANS.personal).toMatchObject({
      monthlyPriceJpyIncTax: 980,
      seatLimit: 1,
      projectLimit: 10,
      trialHours: 120,
    });
    expect(BILLING_PLANS.team).toMatchObject({
      monthlyPriceJpyIncTax: 9800,
      seatLimit: 5,
      // Team のプロジェクト数は無制限
      projectLimit: null,
      trialHours: 120,
    });
  });

  it('正式名称は「Team」であって「Teams」ではない', () => {
    expect(BILLING_PLANS.team.label).toBe('Team');
  });

  it('Stripe で契約を持つのは Personal と Team だけ', () => {
    expect(BILLING_PLANS.free.stripeManaged).toBe(false);
    expect(BILLING_PLANS.personal.stripeManaged).toBe(true);
    expect(BILLING_PLANS.team.stripeManaged).toBe(true);
    // Enterprise は plan_code を用意するのみで契約管理は未実装
    expect(BILLING_PLANS.enterprise.stripeManaged).toBe(false);
  });

  it('画面で選べるのは Free / Personal / Team の 3 つ', () => {
    expect(SELECTABLE_BILLING_PLAN_CODES).toEqual(['free', 'personal', 'team']);
  });

  it('トライアルは 5 日 = 120 時間で、事業要件と一致する', () => {
    expect(TRIAL_PERIOD_DAYS).toBe(5);
    expect(TRIAL_PERIOD_HOURS).toBe(120);
    expect(BILLING_PLANS.personal.trialHours).toBe(TRIAL_PERIOD_HOURS);
    expect(BILLING_PLANS.team.trialHours).toBe(TRIAL_PERIOD_HOURS);
  });

  it('支払い失敗の猶予は 7 日 (Stripe のスマートリトライ設定に対応)', () => {
    expect(PAST_DUE_GRACE_DAYS).toBe(7);
  });

  it('契約状態は Stripe の status に none を足したもの', () => {
    expect(SUBSCRIPTION_STATUSES).toContain('none');
    for (const s of ['trialing', 'active', 'past_due', 'unpaid', 'canceled']) {
      expect(SUBSCRIPTION_STATUSES).toContain(s);
    }
    expect(new Set(SUBSCRIPTION_STATUSES).size).toBe(SUBSCRIPTION_STATUSES.length);
  });
});

describe('hasLiveSubscription', () => {
  it('Stripe 上に契約が残っている状態を true にする', () => {
    for (const s of ['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused'] as const) {
      expect(hasLiveSubscription(s)).toBe(true);
    }
  });

  it('対象が無い状態を false にする', () => {
    // ここで解約・プラン変更を呼ぶと Stripe 側に対象が無く失敗する
    for (const s of ['none', 'canceled', 'incomplete_expired'] as const) {
      expect(hasLiveSubscription(s)).toBe(false);
    }
  });

  it('すべての状態を漏れなく分類している', () => {
    for (const s of SUBSCRIPTION_STATUSES) {
      expect(typeof hasLiveSubscription(s)).toBe('boolean');
    }
  });
});

describe('組織ロール', () => {
  it('全ロールにラベルがある', () => {
    for (const role of ORG_ROLES) {
      expect(ORG_ROLE_LABEL[role].length).toBeGreaterThan(0);
    }
  });

  describe('canManageBilling', () => {
    it('オーナーと管理者は課金操作を行える', () => {
      expect(canManageBilling('owner')).toBe(true);
      expect(canManageBilling('admin')).toBe(true);
    });

    it('一般メンバーは行えない', () => {
      expect(canManageBilling('member')).toBe(false);
    });
  });
});
