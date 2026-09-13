import type { JobTitle, WithdrawalReason } from '@trakon/shared';

import { apiRequest } from '@/lib/api';

export type CurrentUser = {
  id: string;
  /** ログイン用メール */
  email: string;
  fullName: string;
  displayName: string;
  /** 所属名 (#156)。未設定は null */
  organizationName: string | null;
  /** 職種 (#156)。未設定は null */
  jobTitle: JobTitle | null;
  /** 通知先メールの生値 (#156)。フォームはこちらを束縛する */
  notificationEmail: string | null;
  /** 実際の通知先 (#156)。notificationEmail ?? email。表示用 */
  effectiveNotificationEmail: string;
  /** プロフィール画像の Storage キー (#157) */
  avatarPath: string | null;
  primaryAuthMethod: 'password' | 'google' | 'microsoft';
  createdAt: string;
};

export type SyncResponse =
  | { user: CurrentUser; requiresProfileCompletion: false }
  | { user: null; requiresProfileCompletion: true; email: string };

export type CompleteSignupInput = {
  fullName: string;
  displayName: string;
  password: string;
};

export type UpdateProfileInput = {
  fullName?: string;
  displayName?: string;
  /** null / '' で未設定に戻す (#156) */
  organizationName?: string | null;
  jobTitle?: JobTitle | null;
  notificationEmail?: string | null;
  newPassword?: string;
};

export type DeleteAccountInput = {
  reason: WithdrawalReason;
};

export const authApi = {
  syncMe: () => apiRequest<SyncResponse>('/auth/me/sync', { method: 'POST' }),
  getMe: () => apiRequest<CurrentUser>('/auth/me'),
  completeSignup: (body: CompleteSignupInput) =>
    apiRequest<CurrentUser>('/auth/me/complete-signup', { method: 'POST', body }),
  updateProfile: (body: UpdateProfileInput) =>
    apiRequest<CurrentUser>('/auth/me', { method: 'PATCH', body }),
  deleteAccount: (body: DeleteAccountInput) =>
    apiRequest<{ ok: true }>('/auth/me', { method: 'DELETE', body }),
};
