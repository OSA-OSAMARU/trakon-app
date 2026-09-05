import { describe, expect, it } from 'vitest';

import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '../constants/billing.js';
import { evaluateEntitlement, type EntitlementInput } from './entitlement.js';

const NOW = new Date('2026-09-01T00:00:00.000Z');

function input(over: Partial<EntitlementInput> = {}): EntitlementInput {
  return {
    planCode: 'free',
    status: 'none',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    gracePeriodEndsAt: null,
    seatCount: 1,
    projectCount: 0,
    now: NOW,
    ...over,
  };
}

describe('evaluateEntitlement — 契約状態ごとの権限レベル', () => {
  const cases: Array<[SubscriptionStatus, 'full' | 'read_only', string]> = [
    ['none', 'full', 'free'],
    ['trialing', 'full', 'team'],
    ['active', 'full', 'team'],
    ['unpaid', 'read_only', 'team'],
    ['paused', 'read_only', 'team'],
    ['canceled', 'full', 'free'],
    ['incomplete', 'full', 'free'],
    ['incomplete_expired', 'full', 'free'],
  ];

  it.each(cases)('%s → level=%s / 実効プラン=%s', (status, level, effective) => {
    const e = evaluateEntitlement(input({ planCode: 'team', status }));
    expect(e.level).toBe(level);
    expect(e.effectivePlanCode).toBe(effective);
  });

  it('全ての契約状態を網羅している (past_due は猶予の有無で分岐するため別テスト)', () => {
    const covered = new Set(cases.map(([s]) => s));
    covered.add('past_due');
    expect([...covered].sort()).toEqual([...SUBSCRIPTION_STATUSES].sort());
  });
});

describe('evaluateEntitlement — past_due と支払猶予', () => {
  it('猶予期間中は通常どおり利用できる', () => {
    const e = evaluateEntitlement(
      input({
        planCode: 'personal',
        status: 'past_due',
        gracePeriodEndsAt: '2026-09-02T00:00:00.000Z',
      }),
    );
    expect(e.level).toBe('full');
    expect(e.reason).toBe('in_grace_period');
    expect(e.graceEndsAt).toBe('2026-09-02T00:00:00.000Z');
    expect(e.effectivePlanCode).toBe('personal');
  });

  it('猶予期限ちょうどは猶予切れとして扱う (境界値)', () => {
    const e = evaluateEntitlement(
      input({
        planCode: 'personal',
        status: 'past_due',
        gracePeriodEndsAt: NOW.toISOString(),
      }),
    );
    expect(e.level).toBe('read_only');
    expect(e.reason).toBe('grace_expired');
    expect(e.graceEndsAt).toBeNull();
  });

  it('猶予期限が未設定なら猶予なしとして閲覧のみ', () => {
    const e = evaluateEntitlement(input({ planCode: 'personal', status: 'past_due' }));
    expect(e.level).toBe('read_only');
    expect(e.reason).toBe('grace_expired');
  });
});

describe('evaluateEntitlement — 解約予約', () => {
  it('請求期間内は有料権限を維持する', () => {
    const e = evaluateEntitlement(
      input({
        planCode: 'team',
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-09-30T00:00:00.000Z',
      }),
    );
    expect(e.level).toBe('full');
    expect(e.reason).toBe('canceled_pending');
    expect(e.effectivePlanCode).toBe('team');
  });

  it('請求期間終了ちょうどで実効プランが free に落ちる (Webhook 遅延の保険・境界値)', () => {
    const e = evaluateEntitlement(
      input({
        planCode: 'team',
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: NOW.toISOString(),
      }),
    );
    expect(e.reason).toBe('canceled');
    expect(e.effectivePlanCode).toBe('free');
    // 時刻だけを根拠に昇格はしないが、降格はする (安全側)
    expect(e.limits.projectLimit).toBe(2);
  });

  it('請求期間終了日が不明なら有料権限を維持する', () => {
    const e = evaluateEntitlement(
      input({ planCode: 'team', status: 'active', cancelAtPeriodEnd: true }),
    );
    expect(e.reason).toBe('canceled_pending');
    expect(e.effectivePlanCode).toBe('team');
  });

  it('トライアル中の解約予約もトライアル終了まで利用できる', () => {
    const e = evaluateEntitlement(
      input({
        planCode: 'personal',
        status: 'trialing',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-09-06T00:00:00.000Z',
      }),
    );
    expect(e.level).toBe('full');
    expect(e.effectivePlanCode).toBe('personal');
  });
});

describe('evaluateEntitlement — 上限と超過', () => {
  it('Free は会員 1 名・プロジェクト 2 件', () => {
    const e = evaluateEntitlement(input({ seatCount: 1, projectCount: 2 }));
    expect(e.limits).toEqual({ seatLimit: 1, projectLimit: 2 });
    expect(e.over).toEqual({ seats: 0, projects: 0 });
    expect(e.canCreateProject).toBe(false); // 上限ちょうどは作成不可 (境界値)
    expect(e.canInviteMember).toBe(false);
  });

  it('上限未満なら作成・招待できる', () => {
    const e = evaluateEntitlement(input({ seatCount: 0, projectCount: 1 }));
    expect(e.canCreateProject).toBe(true);
    expect(e.canInviteMember).toBe(true);
  });

  it('Team はプロジェクト数が無制限', () => {
    const e = evaluateEntitlement(
      input({ planCode: 'team', status: 'active', seatCount: 5, projectCount: 999 }),
    );
    expect(e.limits.projectLimit).toBeNull();
    expect(e.over.projects).toBe(0);
    expect(e.canCreateProject).toBe(true);
    expect(e.canInviteMember).toBe(false); // 座席は 5 が上限
  });

  it('上限超過でも全体は read_only にしない (凍結はプロジェクト単位)', () => {
    const e = evaluateEntitlement(input({ projectCount: 5 }));
    expect(e.level).toBe('full');
    expect(e.over.projects).toBe(3);
    expect(e.canCreateProject).toBe(false);
    expect(e.message).toContain('3 件のプロジェクトが閲覧のみ');
  });

  it('解約後は Free の上限で判定される', () => {
    const e = evaluateEntitlement(
      input({ planCode: 'team', status: 'canceled', seatCount: 4, projectCount: 7 }),
    );
    expect(e.effectivePlanCode).toBe('free');
    expect(e.over).toEqual({ seats: 3, projects: 5 });
  });

  it('閲覧のみ状態では作成・招待ができない', () => {
    const e = evaluateEntitlement(
      input({ planCode: 'team', status: 'unpaid', seatCount: 1, projectCount: 0 }),
    );
    expect(e.level).toBe('read_only');
    expect(e.canCreateProject).toBe(false);
    expect(e.canInviteMember).toBe(false);
  });
});

describe('evaluateEntitlement — 入力の頑健性', () => {
  it('Date オブジェクトでも ISO 文字列でも同じ結果になる', () => {
    const iso = evaluateEntitlement(
      input({ planCode: 'team', status: 'past_due', gracePeriodEndsAt: '2026-09-05T00:00:00.000Z' }),
    );
    const date = evaluateEntitlement(
      input({
        planCode: 'team',
        status: 'past_due',
        gracePeriodEndsAt: new Date('2026-09-05T00:00:00.000Z'),
      }),
    );
    expect(iso).toEqual(date);
  });

  it('不正な日付文字列は未設定として扱う', () => {
    const e = evaluateEntitlement(
      input({ planCode: 'team', status: 'past_due', gracePeriodEndsAt: 'not-a-date' }),
    );
    expect(e.reason).toBe('grace_expired');
    expect(e.periodEndsAt).toBeNull();
  });

  it('now を省略しても例外にならない', () => {
    const e = evaluateEntitlement({ ...input(), now: undefined });
    expect(e.level).toBe('full');
  });
});
