import { apiRequest } from '@/lib/api';
import type { PlanCategory, PlanState } from '@/features/plans/api';

export type DashboardTask = {
  planId: string;
  projectId: string;
  itemId: string;
  itemName: string;
  title: string;
  category: PlanCategory;
  scheduledDate: string;
  dueDate: string | null;
  /** ボール状態機械 6 値 (#131)。カンバンの列はこれで決まる */
  ballState: PlanState;
  isOverdue: boolean;
  /** カードに出す進行責任者 */
  progressManager: { id: string; name: string } | null;
};

export type DashboardMemberSection = {
  member: {
    id: string;
    name: string;
    organizationName: string;
    memberType: 'client' | 'production';
    /** 自分自身か (「要対応のみ」の絞り込みに使う) */
    isMe: boolean;
  };
  tasks: DashboardTask[];
};

export type DashboardProjectGroup = {
  id: string;
  name: string;
  memberSections: DashboardMemberSection[];
};

export type Dashboard = {
  today: string;
  summary: {
    todayTaskCount: number;
    overdueCount: number;
  };
  projects: DashboardProjectGroup[];
};

export const dashboardApi = {
  get: (today?: string) => {
    const q = today ? `?today=${today}` : '';
    return apiRequest<Dashboard>(`/users/me/dashboard${q}`);
  },
};

export const dashboardQueryKey = {
  base: (today?: string) =>
    today ? (['dashboard', today] as const) : (['dashboard'] as const),
};
