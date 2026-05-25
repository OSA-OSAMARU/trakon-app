import { apiRequest } from '@/lib/api';

export type ProjectSummary = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'closed';
  role: 'director' | 'member';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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
    email: string;
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
  list: () => apiRequest<ProjectSummary[]>('/projects'),
  get: (projectId: string) => apiRequest<ProjectDetail>(`/projects/${projectId}`),
  create: (body: CreateProjectInput) =>
    apiRequest<ProjectDetail>('/projects', { method: 'POST', body }),
  update: (projectId: string, body: UpdateProjectInput) =>
    apiRequest<ProjectDetail>(`/projects/${projectId}`, { method: 'PATCH', body }),

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
};

export const projectsQueryKey = {
  all: ['projects'] as const,
  detail: (id: string) => ['projects', id] as const,
  items: (id: string) => ['projects', id, 'items'] as const,
};
