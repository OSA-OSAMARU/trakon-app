import type { JobTitle, OrgRole, ProjectRole } from '@trakon/shared';

import { apiRequest } from '@/lib/api';

/** 組織のメンバー管理 (#160) — Figma node 406:22 */

export type OrgMember = {
  /** 受諾済みのみ。招待中は null */
  userId: string | null;
  /** 招待中のみ。取り消しに使う */
  invitationId: string | null;
  status: 'active' | 'invited';
  name: string;
  organizationName: string | null;
  email: string;
  jobTitle: JobTitle | null;
  avatarUrl: string | null;
  orgRole: OrgRole | null;
  defaultProjectRole: ProjectRole;
  projectCount: number;
  joinedAt: string | null;
  expiresAt: string | null;
};

/**
 * 参加者に選べる候補 (#238)。
 * 一覧 (`OrgMember`) と違い連絡先を含まない — 選ぶのに要る項目だけ。
 */
export type MemberCandidate = {
  userId: string;
  name: string;
  organizationName: string | null;
  avatarUrl: string | null;
  /** 組織で決められている既定の権限。追加時の初期値に使う */
  defaultProjectRole: ProjectRole;
};

export type MemberCandidates = {
  candidates: MemberCandidate[];
  joinedCount: number;
  pendingCount: number;
};

export type MemberProject = {
  projectId: string;
  projectName: string;
  memberId: string;
  roleType: ProjectRole;
  ballHolderCount: number;
};

export type CreateOrgInvitationInput = {
  name: string;
  email: string;
  organizationName?: string;
  jobTitle?: JobTitle | null;
  roleType: ProjectRole;
  projectIds?: string[];
};

export const orgQueryKey = {
  members: ['organization', 'members'] as const,
  candidates: ['organization', 'members', 'candidates'] as const,
  memberProjects: (userId: string) => ['organization', 'members', userId, 'projects'] as const,
};

export const orgApi = {
  listMembers: () => apiRequest<OrgMember[]>('/organizations/me/members'),
  /** 参加者に選べる候補。組織の会員なら誰でも引ける (#238) */
  listCandidates: () => apiRequest<MemberCandidates>('/organizations/me/members/candidates'),
  listMemberProjects: (userId: string) =>
    apiRequest<MemberProject[]>(`/organizations/me/members/${userId}/projects`),
  changeRole: (userId: string, defaultProjectRole: ProjectRole) =>
    apiRequest<{ userId: string; defaultProjectRole: ProjectRole; affectedProjectIds: string[] }>(
      `/organizations/me/members/${userId}`,
      { method: 'PATCH', body: { defaultProjectRole } },
    ),
  removeMember: (userId: string) =>
    apiRequest<void>(`/organizations/me/members/${userId}`, { method: 'DELETE' }),
  invite: (body: CreateOrgInvitationInput) =>
    apiRequest<{ id: string }>('/organizations/me/invitations', { method: 'POST', body }),
  revokeInvitation: (invitationId: string) =>
    apiRequest<void>(`/organizations/me/invitations/${invitationId}`, { method: 'DELETE' }),
  /** 招待メールを送り直す (#230)。新しいトークンになるので前のリンクは無効になる */
  resendInvitation: (invitationId: string) =>
    apiRequest<{ expiresAt: string }>(
      `/organizations/me/invitations/${invitationId}/resend`,
      { method: 'POST' },
    ),
};
