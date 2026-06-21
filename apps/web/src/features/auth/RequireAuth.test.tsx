import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

// supabase をモックして getSession / onAuthStateChange を制御する。
// vi.mock は巻き上げられるため auth は vi.hoisted で定義する。
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { RequireAuth } from './RequireAuth';
import { http, HttpResponse } from 'msw';

function makeSession(id = 'u1'): Session {
  return {
    access_token: 'tok',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'r',
    user: { id, email: 'me@example.com' },
  } as unknown as Session;
}

function Protected() {
  return <div>保護されたコンテンツ</div>;
}

function renderGuarded(route = '/secret') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/secret"
        element={
          <RequireAuth>
            <Protected />
          </RequireAuth>
        }
      />
      <Route path="/login" element={<div>ログイン画面マーカー</div>} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  auth.getSession.mockReset();
  auth.onAuthStateChange.mockReset();
  auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe() {} } },
  });
});

describe('RequireAuth', () => {
  it('セッションありかつ profile 完了済みなら children を描画する', async () => {
    auth.getSession.mockResolvedValue({ data: { session: makeSession() } });
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json({
          data: {
            user: {
              id: 'u1',
              email: 'me@example.com',
              fullName: '山田',
              displayName: 'やま',
              primaryAuthMethod: 'password',
              createdAt: '2026-01-01T00:00:00Z',
            },
            requiresProfileCompletion: false,
          },
        }),
      ),
    );

    renderGuarded();
    expect(await screen.findByText('保護されたコンテンツ')).toBeInTheDocument();
  });

  it('セッションなしなら /login へリダイレクトする', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    renderGuarded();
    expect(await screen.findByText('ログイン画面マーカー')).toBeInTheDocument();
    expect(screen.queryByText('保護されたコンテンツ')).not.toBeInTheDocument();
  });

  it('profile 未完了なら create-account 画面 (=/login) へリダイレクトする', async () => {
    auth.getSession.mockResolvedValue({ data: { session: makeSession() } });
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json({
          data: { user: null, requiresProfileCompletion: true, email: 'me@example.com' },
        }),
      ),
    );

    renderGuarded();
    expect(await screen.findByText('ログイン画面マーカー')).toBeInTheDocument();
  });

  it('セッション解決中はスピナーを表示する', () => {
    // getSession を未解決にして loading 状態を観測する。
    auth.getSession.mockReturnValue(new Promise(() => {}));
    renderGuarded();
    expect(screen.getByText('読み込み中…')).toBeInTheDocument();
  });
});
