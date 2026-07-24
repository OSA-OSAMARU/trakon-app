import { apiRequest } from '@/lib/api';
import type { Plan } from '@/features/plans/api';

export type ShareScope = 'project' | 'item' | 'plan';

export type ShareLink = {
  id: string;
  projectId: string;
  scopeType: ShareScope;
  scopeTargetId: string | null;
  issuedByMemberId: string;
  issuedAt: string;
  /** null = 無期限 */
  expiresAt: string | null;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  status: 'active' | 'revoked' | 'expired';
};

export type CreateShareLinkResult = {
  shareLink: ShareLink;
  rawToken: string;
  url: string;
};

export type CreateShareLinkInput = {
  scopeType: ShareScope;
  scopeTargetId?: string;
  /** null = 無期限 */
  expiresInHours?: number | null;
};

export type ShareView = {
  share: {
    id: string;
    scopeType: ShareScope;
    scopeTargetId: string | null;
    /** null = 無期限 */
    expiresAt: string | null;
  };
  project: { id: string; name: string; startDate: string; endDate: string };
  items: Array<{ id: string; name: string }>;
  plans: Plan[];
};

export const shareLinksApi = {
  list: (projectId: string) =>
    apiRequest<ShareLink[]>(`/projects/${projectId}/share-links`),
  create: (projectId: string, body: CreateShareLinkInput) =>
    apiRequest<CreateShareLinkResult>(`/projects/${projectId}/share-links`, {
      method: 'POST',
      body,
    }),
  revoke: (projectId: string, shareLinkId: string) =>
    apiRequest<void>(`/projects/${projectId}/share-links/${shareLinkId}`, {
      method: 'DELETE',
    }),
};

export const shareAccessApi = {
  view: (token: string) =>
    apiRequest<ShareView>(`/share/${encodeURIComponent(token)}`),

  // #131: 非会員(クライアント)の操作。確認依頼 / 承認 / 差し戻し。
  // 進行責任者の TOSS(次工程へ進める操作)は共有リンクからは提供しない。
  requestReview: (token: string, planId: string) =>
    apiRequest<{ plan: Plan }>(
      `/share/${encodeURIComponent(token)}/plans/${planId}/request-review`,
      { method: 'POST', body: {} },
    ),
  approve: (token: string, planId: string) =>
    apiRequest<{ plan: Plan }>(`/share/${encodeURIComponent(token)}/plans/${planId}/approve`, {
      method: 'POST',
      body: {},
    }),
  sendBack: (token: string, planId: string) =>
    apiRequest<{ plan: Plan }>(`/share/${encodeURIComponent(token)}/plans/${planId}/send-back`, {
      method: 'POST',
      body: {},
    }),
};

export const shareLinksQueryKey = {
  list: (projectId: string) => ['projects', projectId, 'share-links'] as const,
};
