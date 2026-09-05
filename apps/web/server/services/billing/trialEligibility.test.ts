import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkTrialEligibility,
  emailDomain,
  normalizeEmail,
} from './trialEligibility.js';

const prismaMock = vi.hoisted(() => ({
  billingTrialClaim: { findFirst: vi.fn() },
}));
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

beforeEach(() => {
  prismaMock.billingTrialClaim.findFirst.mockReset().mockResolvedValue(null);
});

describe('normalizeEmail', () => {
  it('大小文字と前後の空白を吸収する', () => {
    expect(normalizeEmail('  User@Example.TEST ')).toBe('user@example.test');
  });

  it('+タグを落とす (同一人物の再取得を防ぐ)', () => {
    expect(normalizeEmail('user+trial2@example.test')).toBe('user@example.test');
  });

  it('Gmail 系はドットも無視する', () => {
    expect(normalizeEmail('first.last@gmail.com')).toBe('firstlast@gmail.com');
    expect(normalizeEmail('first.last@googlemail.com')).toBe('firstlast@googlemail.com');
  });

  it('Gmail 以外のドットは意味を持つので残す', () => {
    expect(normalizeEmail('first.last@example.test')).toBe('first.last@example.test');
  });

  it('メールとして壊れていても落ちない', () => {
    expect(normalizeEmail('not-an-email')).toBe('not-an-email');
  });
});

describe('emailDomain', () => {
  it('ドメイン部を取り出す', () => {
    expect(emailDomain('User@Example.test')).toBe('example.test');
  });

  it('ドメインが無ければ空文字', () => {
    expect(emailDomain('broken')).toBe('');
  });
});

describe('checkTrialEligibility', () => {
  const input = {
    userId: 'u-1',
    organizationId: 'org-1',
    email: 'user@example.test',
    stripeCustomerId: null,
  };

  it('履歴が無ければトライアルを付与する', async () => {
    expect(await checkTrialEligibility(input)).toEqual({ eligible: true, reason: null });
  });

  it('同一ユーザーの履歴があれば拒否する', async () => {
    prismaMock.billingTrialClaim.findFirst.mockResolvedValue({
      userId: 'u-1',
      emailNormalized: 'other@example.test',
      organizationId: 'org-9',
      stripeCustomerId: null,
    });

    expect(await checkTrialEligibility(input)).toEqual({ eligible: false, reason: 'user' });
  });

  it('正規化後のメールが一致すれば拒否する', async () => {
    prismaMock.billingTrialClaim.findFirst.mockResolvedValue({
      userId: 'u-9',
      emailNormalized: 'user@example.test',
      organizationId: 'org-9',
      stripeCustomerId: null,
    });

    const result = await checkTrialEligibility({ ...input, email: 'User+again@Example.test' });

    expect(result).toEqual({ eligible: false, reason: 'email' });
  });

  it('同一組織の履歴があれば拒否する', async () => {
    prismaMock.billingTrialClaim.findFirst.mockResolvedValue({
      userId: 'u-9',
      emailNormalized: 'other@example.test',
      organizationId: 'org-1',
      stripeCustomerId: null,
    });

    expect(await checkTrialEligibility(input)).toEqual({ eligible: false, reason: 'organization' });
  });

  it('過去の顧客 ID が一致すれば拒否する', async () => {
    prismaMock.billingTrialClaim.findFirst.mockResolvedValue({
      userId: 'u-9',
      emailNormalized: 'other@example.test',
      organizationId: 'org-9',
      stripeCustomerId: 'cus_1',
    });

    const result = await checkTrialEligibility({ ...input, stripeCustomerId: 'cus_1' });

    expect(result).toEqual({ eligible: false, reason: 'customer' });
  });

  it('解除済みの履歴は判定に使わない (誤判定は運用で解除できる)', async () => {
    await checkTrialEligibility(input);

    expect(prismaMock.billingTrialClaim.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ releasedAt: null }) }),
    );
  });

  it('顧客 ID が無ければ条件に含めない', async () => {
    await checkTrialEligibility(input);

    const where = prismaMock.billingTrialClaim.findFirst.mock.calls[0]![0].where as {
      OR: Record<string, unknown>[];
    };
    expect(where.OR).toHaveLength(3);
    expect(where.OR.some((c) => 'stripeCustomerId' in c)).toBe(false);
  });

  it('カードの識別子は判定に使わない (法人カード共有での誤判定を避ける)', async () => {
    await checkTrialEligibility(input);

    const call = JSON.stringify(prismaMock.billingTrialClaim.findFirst.mock.calls[0]);
    expect(call).not.toMatch(/fingerprint/i);
  });
});
