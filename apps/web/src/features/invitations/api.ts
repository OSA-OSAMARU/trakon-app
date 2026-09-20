import type { InvitationAcceptDTO, InvitationVerifyDTO } from '@trakon/shared';

import { apiRequest } from '@/lib/api';

/**
 * 応答型は BE と同じ定義 (@trakon/shared) を使う。
 * ここで作り直すと BE の変更に気付けない (#228)。
 */
export type InvitationVerify = InvitationVerifyDTO;
export type InvitationAccept = InvitationAcceptDTO;

export const invitationsApi = {
  verify: (token: string) =>
    apiRequest<InvitationVerify>(`/invitations/${encodeURIComponent(token)}`),
  accept: (token: string) =>
    apiRequest<InvitationAccept>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
    ),
};
