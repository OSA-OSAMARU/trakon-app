import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/handlers';

// supabase はモックして getSession を制御する (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { supabase } from '@/lib/supabase';
import { authApi } from './api';
import type { CurrentUser, SyncResponse } from './api';

const getSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } });
});

const stubUser: CurrentUser = {
  id: 'u-1',
  email: 'user@example.com',
  fullName: '山田太郎',
  displayName: 'たろう',
  primaryAuthMethod: 'password',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('authApi', () => {
  it('syncMe: POST して SyncResponse を返す', async () => {
    let method = '';
    const sync: SyncResponse = { user: stubUser, requiresProfileCompletion: false };
    server.use(
      http.post('*/api/v1/auth/me/sync', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ data: sync });
      }),
    );
    const res = await authApi.syncMe();
    expect(res).toEqual(sync);
    expect(method).toBe('POST');
  });

  it('getMe: GET で現在のユーザーを返す', async () => {
    server.use(
      http.get('*/api/v1/auth/me', () => HttpResponse.json({ data: stubUser })),
    );
    const res = await authApi.getMe();
    expect(res).toEqual(stubUser);
  });

  it('completeSignup: POST で body を送る', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.post('*/api/v1/auth/me/complete-signup', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ data: stubUser });
      }),
    );
    const input = { fullName: '山田太郎', displayName: 'たろう', password: 'pw' };
    const res = await authApi.completeSignup(input);
    expect(res).toEqual(stubUser);
    expect(method).toBe('POST');
    expect(body).toEqual(input);
  });

  it('updateProfile: PATCH で body を送る', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.patch('*/api/v1/auth/me', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ data: stubUser });
      }),
    );
    await authApi.updateProfile({ displayName: '別名' });
    expect(method).toBe('PATCH');
    expect(body).toEqual({ displayName: '別名' });
  });

  it('エラー応答時は reject する', async () => {
    server.use(
      http.get('*/api/v1/auth/me', () =>
        HttpResponse.json(
          { error: { code: 'PROFILE_NOT_COMPLETED', message: '未完了' } },
          { status: 404 },
        ),
      ),
    );
    await expect(authApi.getMe()).rejects.toMatchObject({
      code: 'PROFILE_NOT_COMPLETED',
      status: 404,
    });
  });
});
