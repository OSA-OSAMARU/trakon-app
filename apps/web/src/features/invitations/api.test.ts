import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/handlers';

// supabase はモックして getSession を制御する (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { supabase } from '@/lib/supabase';
import { invitationsApi } from './api';
import type { InvitationVerify, InvitationAccept } from './api';

const getSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } });
});

const stubVerify: InvitationVerify = {
  project: { id: 'proj-1', name: 'プロジェクト' },
  invitedMember: {
    id: 'm-1',
    name: '田中',
    email: 'tanaka@example.com',
    organizationName: '株式会社A',
    memberType: 'production',
  },
  expiresAt: '2026-02-01T00:00:00Z',
};

describe('invitationsApi', () => {
  it('verify: token を URL エンコードして取得する', async () => {
    let url = '';
    server.use(
      http.get('*/api/v1/invitations/:token', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: stubVerify });
      }),
    );
    const res = await invitationsApi.verify('a/b c');
    expect(res).toEqual(stubVerify);
    expect(url).toContain('/invitations/a%2Fb%20c');
  });

  it('accept: POST で token をエンコードして送る', async () => {
    let method = '';
    let url = '';
    const accept: InvitationAccept = {
      project: { id: 'proj-1', name: 'プロジェクト' },
      member: { id: 'm-1', memberType: 'production' },
    };
    server.use(
      http.post('*/api/v1/invitations/:token/accept', ({ request }) => {
        method = request.method;
        url = request.url;
        return HttpResponse.json({ data: accept });
      }),
    );
    const res = await invitationsApi.accept('tok-123');
    expect(res).toEqual(accept);
    expect(method).toBe('POST');
    expect(url).toContain('/invitations/tok-123/accept');
  });

  it('エラー応答時は reject する', async () => {
    server.use(
      http.get('*/api/v1/invitations/:token', () =>
        HttpResponse.json(
          { error: { code: 'INVITATION_EXPIRED', message: '期限切れ' } },
          { status: 410 },
        ),
      ),
    );
    await expect(invitationsApi.verify('tok')).rejects.toMatchObject({
      code: 'INVITATION_EXPIRED',
      status: 410,
    });
  });
});
