import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Session } from '@supabase/supabase-js';
import type * as ReactRouterDom from 'react-router-dom';

// supabase をモックして getSession / onAuthStateChange を制御する。
// vi.mock は巻き上げられるため auth は vi.hoisted で定義する。
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));

// useNavigate を捕捉する。
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterDom>();
  return { ...actual, useNavigate: () => navigate };
});

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { AuthCallbackPage } from './AuthCallbackPage';

function makeSession(id = 'u1'): Session {
  return {
    access_token: 'tok',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'r',
    user: { id, email: 'me@example.com' },
  } as unknown as Session;
}

const syncedUser = {
  id: 'u1',
  email: 'me@example.com',
  fullName: '山田',
  displayName: 'やま',
  primaryAuthMethod: 'password' as const,
  createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  auth.getSession.mockReset();
  auth.onAuthStateChange.mockReset();
  navigate.mockReset();
  auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe() {} } },
  });
});

describe('AuthCallbackPage', () => {
  it('ローディング中はスピナー文言を表示する', () => {
    auth.getSession.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<AuthCallbackPage />, { route: '/auth/callback' });
    expect(screen.getByText('認証情報を確認しています…')).toBeInTheDocument();
  });

  it('セッションなしなら /login へ遷移する', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    renderWithProviders(<AuthCallbackPage />, { route: '/auth/callback' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }));
  });

  it('プロフィール完了済みなら /dashboard へ遷移する', async () => {
    auth.getSession.mockResolvedValue({ data: { session: makeSession() } });
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json({ data: { user: syncedUser, requiresProfileCompletion: false } }),
      ),
    );
    renderWithProviders(<AuthCallbackPage />, { route: '/auth/callback' });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true }),
    );
  });

  it('プロフィール未完了なら create-account 画面へ遷移する', async () => {
    auth.getSession.mockResolvedValue({ data: { session: makeSession() } });
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json({
          data: { user: null, requiresProfileCompletion: true, email: 'me@example.com' },
        }),
      ),
    );
    renderWithProviders(<AuthCallbackPage />, { route: '/auth/callback' });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/login?screen=create-account', { replace: true }),
    );
  });

  it('プロバイダエラー (?error=...) は遷移せずエラーメッセージを表示する', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    renderWithProviders(<AuthCallbackPage />, {
      route:
        '/auth/callback?error=server_error&error_description=Error+getting+user+email+from+external+provider',
    });
    expect(
      await screen.findByText(/メールアドレスを取得できなかった/),
    ).toBeInTheDocument();
    // 詳細 (元の error_description) も併記して再発調査を容易にする。
    expect(screen.getByText(/Error getting user email from external provider/)).toBeInTheDocument();
    // 無言リダイレクトは行わない。
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sync がエラーなら /login へ遷移する', async () => {
    auth.getSession.mockResolvedValue({ data: { session: makeSession() } });
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'boom' } },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(<AuthCallbackPage />, { route: '/auth/callback' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }));
  });
});
