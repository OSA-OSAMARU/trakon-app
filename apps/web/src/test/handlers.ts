import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import type { OrganizationBilling } from '@/features/billing/api';

/**
 * 既定ハンドラは原則空。各テストで server.use() を使い、必要なエンドポイントだけ
 * モックする。未登録リクエストは onUnhandledRequest='error' で検出される。
 *
 * 例外として `GET /billing/subscription` だけ既定を置く。認証後の共通レイアウトが
 * プランバッジと課金バナーのために毎回呼ぶため、既定が無いと全ページのテストが
 * 未ハンドルで落ちてしまう (設計書 §4.5.2)。Free / 上限内 / 制限なしを既定にする。
 */
export const defaultBillingResponse: OrganizationBilling = {
  organizationId: 'org-test',
  organizationName: 'テスト組織',
  orgRole: 'owner',
  subscription: {
    planCode: 'free',
    status: 'none',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    trialEnd: null,
    gracePeriodEndsAt: null,
    pendingPlanCode: null,
    pendingPlanEffectiveAt: null,
    paymentMethod: null,
    hasStripeCustomer: false,
  },
  entitlement: {
    level: 'full',
    reason: 'free',
    planCode: 'free',
    effectivePlanCode: 'free',
    limits: { seatLimit: 1, projectLimit: 2 },
    usage: { seatCount: 1, projectCount: 0 },
    over: { seats: 0, projects: 0 },
    canCreateProject: true,
    canInviteMember: false,
    graceEndsAt: null,
    periodEndsAt: null,
    message: 'Free プランを利用中です。',
  },
  frozenProjectIds: [],
};

export const server = setupServer(
  http.get('*/api/v1/billing/subscription', () =>
    HttpResponse.json({ data: defaultBillingResponse }),
  ),
);
