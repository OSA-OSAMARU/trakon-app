import type { JobTitle, MemberType } from '@trakon/shared';

import { apiRequest } from '@/lib/api';

export type ProjectMember = {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  organizationName: string;
  memberType: MemberType;
  /** 職種 (#147)。表示用で権限には影響しない */
  jobTitle: JobTitle | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AddMembersInput = {
  members: Array<{
    name: string;
    email?: string;
    organizationName: string;
    memberType: MemberType;
    jobTitle?: JobTitle | null;
  }>;
};

export type UpdateMemberInput = Partial<{
  name: string;
  organizationName: string;
  memberType: MemberType;
  jobTitle: JobTitle | null;
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
  reorder: (projectId: string, orderedIds: string[]) =>
    apiRequest<ProjectMember[]>(`/projects/${projectId}/members/reorder`, {
      method: 'POST',
      body: { orderedIds },
    }),
};

export const membersQueryKey = {
  list: (projectId: string) => ['projects', projectId, 'members'] as const,
};
