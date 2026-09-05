import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getEntitlement, getOrganizationBilling } from './entitlement.js';

// 判定そのものは packages/shared の evaluateEntitlement が持つ (単体テスト済み)。
// ここは「DB から入力を正しく組み立てて渡すか」「DTO に何を出すか」だけを見る。

const prismaMock = vi.hoisted(() => ({
  organization: { findUniqueOrThrow: vi.fn() },
  billingSubscription: { findUnique: vi.fn() },
  organizationMember: { count: vi.fn() },
  invitation: { count: vi.fn() },
  project: { count: vi.fn(), findMany: vi.fn() },
}));
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

beforeEach(() => {
  prismaMock.organization.findUniqueOrThrow
    .mockReset()
    .mockResolvedValue({ id: 'org-1', name: 'テスト組織' });
  prismaMock.billingSubscription.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.organizationMember.count.mockReset().mockResolvedValue(1);
  prismaMock.invitation.count.mockReset().mockResolvedValue(0);
  prismaMock.project.count.mockReset().mockResolvedValue(0);
  prismaMock.project.findMany.mockReset().mockResolvedValue([]);
});

const db = () => prismaMock as unknown as Parameters<typeof getEntitlement>[0];

describe('getEntitlement', () => {
  it('契約行が無ければ Free として扱う', async () => {
    const entitlement = await getEntitlement(db(), 'org-1');

    expect(entitlement).toMatchObject({
      level: 'full',
      effectivePlanCode: 'free',
      limits: { seatLimit: 1, projectLimit: 2 },
    });
  });

  it('契約の状態と上限を DB から組み立てる', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      planCode: 'team',
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      gracePeriodEndsAt: null,
    });
    prismaMock.organizationMember.count.mockResolvedValue(5);
    prismaMock.project.count.mockResolvedValue(30);

    const entitlement = await getEntitlement(db(), 'org-1');

    expect(entitlement).toMatchObject({
      level: 'full',
      effectivePlanCode: 'team',
      usage: { seatCount: 5, projectCount: 30 },
      canInviteMember: false,
      canCreateProject: true,
    });
  });

  it('未払いは閲覧のみに落とす', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      planCode: 'team',
      status: 'unpaid',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      gracePeriodEndsAt: null,
    });

    expect((await getEntitlement(db(), 'org-1')).level).toBe('read_only');
  });
});

describe('getOrganizationBilling', () => {
  it('アーカイブ済みは利用数に数えないが、一覧には含める', async () => {
    prismaMock.project.findMany.mockResolvedValue([
      { id: 'p1', createdAt: new Date('2026-01-01'), archivedAt: null, retainedAt: null },
      { id: 'p2', createdAt: new Date('2026-01-02'), archivedAt: null, retainedAt: null },
      { id: 'p3', createdAt: new Date('2026-01-03'), archivedAt: new Date(), retainedAt: null },
    ]);

    const dto = await getOrganizationBilling('org-1');

    // Free は 2 件まで。アーカイブ済みは枠を空ける
    expect(dto.entitlement.usage.projectCount).toBe(2);
    expect(dto.frozenProjectIds).toEqual([]);
  });

  it('上限超過分を凍結対象として返す', async () => {
    prismaMock.project.findMany.mockResolvedValue([
      { id: 'p1', createdAt: new Date('2026-01-01'), archivedAt: null, retainedAt: null },
      { id: 'p2', createdAt: new Date('2026-01-02'), archivedAt: null, retainedAt: null },
      { id: 'p3', createdAt: new Date('2026-01-03'), archivedAt: null, retainedAt: null },
    ]);

    const dto = await getOrganizationBilling('org-1');

    expect(dto.frozenProjectIds).toEqual(['p3']);
  });

  it('カード情報はブランドと下 4 桁だけを返す (SR-BILL-02)', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      planCode: 'team',
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      trialEnd: null,
      gracePeriodEndsAt: null,
      pendingPlanCode: null,
      pendingPlanEffectiveAt: null,
      defaultPaymentMethodBrand: 'visa',
      defaultPaymentMethodLast4: '4242',
      stripeCustomerId: 'cus_1',
    });

    const dto = await getOrganizationBilling('org-1');

    expect(dto.subscription.paymentMethod).toEqual({ brand: 'visa', last4: '4242' });
    expect(dto.subscription.hasStripeCustomer).toBe(true);
    // 顧客 ID や契約 ID は画面へ出さない
    expect(JSON.stringify(dto.subscription)).not.toContain('cus_1');
  });

  it('カード未登録なら支払い方法は null', async () => {
    const dto = await getOrganizationBilling('org-1');

    expect(dto.subscription.paymentMethod).toBeNull();
    expect(dto.subscription.hasStripeCustomer).toBe(false);
    expect(dto.subscription.planCode).toBe('free');
    expect(dto.subscription.status).toBe('none');
  });

  it('日時は ISO 文字列で返す', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      planCode: 'team',
      status: 'past_due',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      trialEnd: new Date('2026-09-06T00:00:00Z'),
      gracePeriodEndsAt: new Date('2026-09-08T00:00:00Z'),
      pendingPlanCode: 'personal',
      pendingPlanEffectiveAt: new Date('2026-10-01T00:00:00Z'),
      defaultPaymentMethodBrand: null,
      defaultPaymentMethodLast4: null,
      stripeCustomerId: 'cus_1',
    });

    const dto = await getOrganizationBilling('org-1');

    expect(dto.subscription).toMatchObject({
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
      trialEnd: '2026-09-06T00:00:00.000Z',
      gracePeriodEndsAt: '2026-09-08T00:00:00.000Z',
      pendingPlanCode: 'personal',
      pendingPlanEffectiveAt: '2026-10-01T00:00:00.000Z',
    });
    expect(dto.organizationName).toBe('テスト組織');
  });
});
