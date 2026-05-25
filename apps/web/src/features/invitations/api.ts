import { apiRequest } from '@/lib/api';

export type InvitationVerify = {
  project: { id: string; name: string };
  invitedMember: {
    id: string;
    name: string;
    email: string;
    organizationName: string;
    memberType: 'client' | 'production';
  };
  expiresAt: string;
};

export type InvitationAccept = {
  project: { id: string; name: string };
  member: { id: string; memberType: 'client' | 'production' };
};

export const invitationsApi = {
  verify: (token: string) =>
    apiRequest<InvitationVerify>(`/invitations/${encodeURIComponent(token)}`),
  accept: (token: string) =>
    apiRequest<InvitationAccept>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
    ),
};
