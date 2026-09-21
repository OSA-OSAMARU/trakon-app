import type { JobTitle, MemberType, ProjectRole } from '@trakon/shared';

import { apiRequest } from '@/lib/api';
import type { MemberCandidate } from '@/features/organization/api';

export type ProjectMember = {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  organizationName: string;
  memberType: MemberType;
  /** 職種 (#147)。アカウント紐付け済みなら users 側が正 (#156)。権限には影響しない */
  jobTitle: JobTitle | null;
  /** プロフィール画像の表示 URL (#157)。署名付き・1 時間有効。未設定は null */
  avatarUrl: string | null;
  /** 権限ロール (FR-ROLE-01)。操作権限の唯一の根拠 */
  roleType: ProjectRole;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * 参加者の追加 (#202)。
 * 「メンバー管理」の組織メンバーから選ぶ。氏名・メール・所属・職種は
 * アカウント側が正 (#156) なのでサーバーが引く。
 */
export type AddMembersInput = {
  members: Array<{
    userId: string;
    memberType: MemberType;
    /** 省略時は組織で設定された既定ロール */
    roleType?: ProjectRole;
  }>;
};

/**
 * 参加者に追加できる候補と、**候補が空になった理由** (#238)。
 * 数が分かると「招待して」なのか「全員もう入っている」なのかを画面で言い分けられる。
 */
export type MemberCandidates = {
  candidates: MemberCandidate[];
  /** 既にこのプロジェクトに居るため候補から外れた組織メンバーの数 */
  joinedCount: number;
  /** 未受諾の招待の数。承諾されれば候補になる */
  pendingCount: number;
};

export type UpdateMemberInput = Partial<{
  name: string;
  organizationName: string;
  memberType: MemberType;
  jobTitle: JobTitle | null;
  roleType: ProjectRole;
  sortOrder: number;
}>;

export const membersApi = {
  list: (projectId: string) =>
    apiRequest<ProjectMember[]>(`/projects/${projectId}/members`),
  candidates: (projectId: string) =>
    apiRequest<MemberCandidates>(`/projects/${projectId}/members/candidates`),
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
  candidates: (projectId: string) => ['projects', projectId, 'members', 'candidates'] as const,
};
