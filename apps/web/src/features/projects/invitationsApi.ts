import type { JobTitle, MemberType, ProjectRole } from '@trakon/shared';

import { apiRequest } from '@/lib/api';

/** 未受諾かつ有効期限内の招待 (= 座席を消費している招待)。 */
export type PendingInvitation = {
  id: string;
  email: string;
  roleType: ProjectRole;
  memberId: string;
  memberName: string;
  invitedByUserId: string | null;
  expiresAt: string;
  createdAt: string;
};

export type CreateInvitationInput = {
  email: string;
  roleType: ProjectRole;
  /** 既存の担当者行を招待する場合はその id */
  memberId?: string;
  name?: string;
  organizationName?: string;
  memberType?: MemberType;
  jobTitle?: JobTitle | null;
};

export const invitationsApi = {
  list: (projectId: string) =>
    apiRequest<PendingInvitation[]>(`/projects/${projectId}/invitations`),

  create: (projectId: string, body: CreateInvitationInput) =>
    apiRequest<PendingInvitation>(`/projects/${projectId}/invitations`, {
      method: 'POST',
      body,
    }),

  revoke: (projectId: string, invitationId: string) =>
    apiRequest<void>(`/projects/${projectId}/invitations/${invitationId}`, {
      method: 'DELETE',
    }),
};

export const invitationsQueryKey = {
  list: (projectId: string) => ['projects', projectId, 'invitations'] as const,
};
