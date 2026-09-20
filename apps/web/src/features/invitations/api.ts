import type {
  InvitationAcceptDTO,
  InvitationSignupDTO,
  InvitationVerifyDTO,
} from '@trakon/shared';

import { apiRequest } from '@/lib/api';

/**
 * 応答型は BE と同じ定義 (@trakon/shared) を使う。
 * ここで作り直すと BE の変更に気付けない (#228)。
 */
export type InvitationVerify = InvitationVerifyDTO;
export type InvitationAccept = InvitationAcceptDTO;
export type InvitationSignup = InvitationSignupDTO;

export type InvitationSignupInput = {
  fullName: string;
  displayName: string;
  password: string;
};

export const invitationsApi = {
  verify: (token: string) =>
    apiRequest<InvitationVerify>(`/invitations/${encodeURIComponent(token)}`),
  accept: (token: string) =>
    apiRequest<InvitationAccept>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
    ),
  /**
   * 招待からそのままアカウントを作って参加する (#233)。未認証で呼ぶ。
   * メールは招待が持っているので送らない。
   */
  signup: (token: string, body: InvitationSignupInput) =>
    apiRequest<InvitationSignup>(
      `/invitations/${encodeURIComponent(token)}/signup`,
      { method: 'POST', body },
    ),
};
