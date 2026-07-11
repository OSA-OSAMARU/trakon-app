import { apiRequest } from '@/lib/api';

export type ProjectMember = {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  organizationName: string;
  memberType: 'client' | 'production';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AddMembersInput = {
  members: Array<{
    name: string;
    email?: string;
    organizationName: string;
    memberType: 'client' | 'production';
  }>;
};

export type UpdateMemberInput = Partial<{
  name: string;
  organizationName: string;
  memberType: 'client' | 'production';
  sortOrder: number;
}>;

export const membersApi = {
  list: (projectId: string) =>
    apiRequest<ProjectMember[]>(`/projects/${projectId}/members`),
  add: (projectId: string, body: AddMembersInput) =>
    apiRequest<ProjectMember[]>(`/projects/${projectId}/members`, {
      method: 'POST',
      body,
    }),
  update: (projectId: string, memberId: string, body: UpdateMemberInput) =>
    apiRequest<ProjectMember>(`/projects/${projectId}/members/${memberId}`, {
      method: 'PATCH',
      body,
    }),
  remove: (projectId: string, memberId: string) =>
    apiRequest<void>(`/projects/${projectId}/members/${memberId}`, {
      method: 'DELETE',
    }),
};

export const membersQueryKey = {
  list: (projectId: string) => ['projects', projectId, 'members'] as const,
};
