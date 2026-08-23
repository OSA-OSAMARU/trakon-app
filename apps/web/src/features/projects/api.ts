import { apiRequest } from '@/lib/api';

export type ProjectSummary = {
  id: string;
  name: string;
  /** クライアント名 (#147) */
  clientName: string | null;
  startDate: string;
  endDate: string;
  status: 'active' | 'closed';
  /** アーカイブ日時 (null = 未アーカイブ) */
  archivedAt: string | null;
  role: 'director' | 'member';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** 予定作成時の進行責任者の既定値 (#131) */
  progressManager: { id: string; name: string } | null;
  /** 期限超過しているボールの数 (#147)。一覧で遅延を見分けるのに使う */
  overdueCount: number;
};

export type ProjectDetail = ProjectSummary & {
  counts: { memberCount: number; itemCount: number };
};

export type ProjectItem = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  startDate: string | null;
  endDate: string | null;
  counts: { activePlanCount: number; completedPlanCount: number };
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectInput = {
  name: string;
  startDate: string;
  endDate: string;
  items: Array<{ name: string }>;
  members: Array<{
    name: string;
    email?: string;
    organizationName: string;
    memberType: 'client' | 'production';
  }>;
};

export type UpdateProjectInput = Partial<{
  name: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'closed';
}>;

export type Warning = { code: string; message: string };

export const projectsApi = {
  list: (params?: { archived?: boolean }) =>
    apiRequest<ProjectSummary[]>(`/projects${params?.archived ? '?archived=true' : ''}`),
  get: (projectId: string) => apiRequest<ProjectDetail>(`/projects/${projectId}`),
  create: (body: CreateProjectInput) =>
    apiRequest<ProjectDetail>('/projects', { method: 'POST', body }),
  update: (projectId: string, body: UpdateProjectInput) =>
    apiRequest<ProjectDetail>(`/projects/${projectId}`, { method: 'PATCH', body }),
  archive: (projectId: string) =>
    apiRequest<ProjectDetail>(`/projects/${projectId}/archive`, { method: 'POST' }),
  unarchive: (projectId: string) =>
    apiRequest<ProjectDetail>(`/projects/${projectId}/unarchive`, { method: 'POST' }),

  listItems: (projectId: string) =>
    apiRequest<ProjectItem[]>(`/projects/${projectId}/items`),
  createItem: (projectId: string, body: { name: string; sortOrder?: number }) =>
    apiRequest<ProjectItem>(`/projects/${projectId}/items`, { method: 'POST', body }),
  updateItem: (
    projectId: string,
    itemId: string,
    body: { name?: string; sortOrder?: number },
  ) =>
    apiRequest<ProjectItem>(`/projects/${projectId}/items/${itemId}`, {
      method: 'PATCH',
      body,
    }),
  deleteItem: (projectId: string, itemId: string) =>
    apiRequest<void>(`/projects/${projectId}/items/${itemId}`, { method: 'DELETE' }),
  reorderItems: (projectId: string, orderedIds: string[]) =>
    apiRequest<ProjectItem[]>(`/projects/${projectId}/items/reorder`, {
      method: 'POST',
      body: { orderedIds },
    }),
};

export const projectsQueryKey = {
  all: ['projects'] as const,
  archived: ['projects', 'archived'] as const,
  detail: (id: string) => ['projects', id] as const,
  items: (id: string) => ['projects', id, 'items'] as const,
};
