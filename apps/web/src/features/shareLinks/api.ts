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
  expiresAt: string;
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
  expiresInHours?: number;
};

export type ShareView = {
  share: {
    id: string;
    scopeType: ShareScope;
    scopeTargetId: string | null;
    expiresAt: string;
  };
  project: { id: string; name: string };
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
  toss: (token: string, planId: string) =>
    apiRequest<{ plan: Plan }>(
      `/share/${encodeURIComponent(token)}/plans/${planId}/toss`,
      { method: 'POST' },
    ),
  complete: (token: string, planId: string) =>
    apiRequest<{ plan: Plan; autoTossed: Plan | null }>(
      `/share/${encodeURIComponent(token)}/plans/${planId}/complete`,
      { method: 'POST' },
    ),
};

export const shareLinksQueryKey = {
  list: (projectId: string) => ['projects', projectId, 'share-links'] as const,
};
