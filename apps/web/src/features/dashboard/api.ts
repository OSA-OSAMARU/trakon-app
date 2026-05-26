import { apiRequest } from '@/lib/api';
import type { PlanCategory } from '@/features/plans/api';

export type DashboardTask = {
  planId: string;
  projectId: string;
  itemId: string;
  itemName: string;
  title: string;
  category: PlanCategory;
  scheduledDate: string;
  dueDate: string | null;
  ballState: 'ready' | 'tossed' | 'completed';
  isOverdue: boolean;
};

export type DashboardMemberSection = {
  member: {
    id: string;
    name: string;
    organizationName: string;
    memberType: 'client' | 'production';
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
