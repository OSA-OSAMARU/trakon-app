import type { BillingPlanCode, Entitlement, OrgRole, SubscriptionStatus } from '@trakon/shared';

import { apiRequest } from '@/lib/api';

export type BillingSubscriptionSummary = {
  planCode: BillingPlanCode;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  gracePeriodEndsAt: string | null;
  pendingPlanCode: BillingPlanCode | null;
  pendingPlanEffectiveAt: string | null;
  paymentMethod: { brand: string | null; last4: string | null } | null;
  hasStripeCustomer: boolean;
};

export type OrganizationBilling = {
  organizationId: string;
  organizationName: string;
  subscription: BillingSubscriptionSummary;
  entitlement: Entitlement;
  /** 上限超過で閲覧のみになっているプロジェクト */
  frozenProjectIds: string[];
  orgRole: OrgRole;
};

export type CheckoutablePlan = 'personal' | 'team';

export const billingApi = {
  get: () => apiRequest<OrganizationBilling>('/billing/subscription'),

  /**
   * 契約状態を Stripe の現在値へ合わせ直す (#209)。
   *
   * Webhook が届かない環境 (Preview デプロイなど) や配信が遅れている間に
   * 「反映待ち」で止まらないようにするための経路。返り値は GET と同じ形。
   */
  sync: (checkoutSessionId?: string | null) =>
    apiRequest<OrganizationBilling>('/billing/sync', {
      method: 'POST',
      body: checkoutSessionId ? { checkoutSessionId } : {},
    }),

  checkout: (planCode: CheckoutablePlan) =>
    apiRequest<{ url: string; trialApplied: boolean }>('/billing/checkout-session', {
      method: 'POST',
      body: { planCode },
    }),

  portal: () => apiRequest<{ url: string }>('/billing/portal-session', { method: 'POST' }),

  changePlan: (planCode: CheckoutablePlan) =>
    apiRequest<{ appliedImmediately: boolean; pendingPlanCode: BillingPlanCode }>('/billing/plan', {
      method: 'POST',
      body: { planCode },
    }),

  cancel: () =>
    apiRequest<{ cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }>('/billing/cancel', {
      method: 'POST',
    }),

  resume: () => apiRequest<{ cancelAtPeriodEnd: boolean }>('/billing/resume', { method: 'POST' }),

  setRetainedProjects: (projectIds: string[]) =>
    apiRequest<{ retainedIds: string[]; frozenIds: string[] }>(
      '/organizations/me/retained-projects',
      { method: 'POST', body: { projectIds } },
    ),
};

export const billingQueryKey = {
  subscription: ['billing', 'subscription'] as const,
};
