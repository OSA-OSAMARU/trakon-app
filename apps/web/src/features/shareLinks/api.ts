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
  // 共有画面は閲覧専用 (#59)。操作系 (toss/complete) は FE からは呼び出さない。
  view: (token: string) =>
    apiRequest<ShareView>(`/share/${encodeURIComponent(token)}`),
};

export const shareLinksQueryKey = {
  list: (projectId: string) => ['projects', projectId, 'share-links'] as const,
};
