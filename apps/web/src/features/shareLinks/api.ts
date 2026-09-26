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
  /**
   * 共有 URL (#255)。発行後も一覧から確認・コピーできる。
   * null は「#255 以前に発行された」か「サーバーに復号鍵が無い」ケースで、
   * リンク自体は有効なまま URL の再表示だけができない状態。
   */
  url: string | null;
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

/**
 * 共有リンク (非会員) の API は **閲覧のみ** (#257)。
 *
 * #131 で用意していた確認依頼 / 承認 / 差し戻しは削除した。全プランで
 * 「共有リンクで訪れた人は閲覧のみ」という方針になったため、サーバー側の
 * エンドポイントも無い (設計書 §3.6.10)。
 */
export const shareAccessApi = {
  view: (token: string) => apiRequest<ShareView>(`/share/${encodeURIComponent(token)}`),
};

export const shareLinksQueryKey = {
  list: (projectId: string) => ['projects', projectId, 'share-links'] as const,
};
