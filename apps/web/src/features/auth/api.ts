import { apiRequest } from '@/lib/api';

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  displayName: string;
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
  newPassword?: string;
};

export const authApi = {
  syncMe: () => apiRequest<SyncResponse>('/auth/me/sync', { method: 'POST' }),
  getMe: () => apiRequest<CurrentUser>('/auth/me'),
  completeSignup: (body: CompleteSignupInput) =>
    apiRequest<CurrentUser>('/auth/me/complete-signup', { method: 'POST', body }),
  updateProfile: (body: UpdateProfileInput) =>
    apiRequest<CurrentUser>('/auth/me', { method: 'PATCH', body }),
};
