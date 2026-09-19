import type { BillingPlanCode } from '@trakon/shared';

import { apiRequest } from '@/lib/api';

/** 運営向けの集計 (#204)。金額は扱わない (売上は Stripe が正)。 */

export type PlanBreakdownRow = {
  planCode: BillingPlanCode;
  organizationCount: number;
  memberCount: number;
  activeProjectCount: number;
  trialingCount: number;
};

export type PlatformMetrics = {
  generatedAt: string;
  users: { total: number; newIn30Days: number; withoutOrganization: number };
  organizations: { total: number; paid: number };
  projects: { active: number; archived: number };
  planBreakdown: PlanBreakdownRow[];
};

export const adminQueryKey = {
  metrics: ['admin', 'metrics'] as const,
};

export const adminApi = {
  metrics: () => apiRequest<PlatformMetrics>('/admin/metrics'),
};
