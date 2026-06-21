import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createElement } from 'react';

import { server } from '@/test/handlers';
import { createTestQueryClient } from '@/test/render';

// supabase をモックして getSession / onAuthStateChange を制御する。
const getSession = vi.fn();
const onAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe() {} } },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChange(...(args as [])),
    },
  },
}));

import { useCurrentUser } from './useCurrentUser';

function makeSession(id = 'u1'): Session {
  return {
    access_token: 'tok',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'r',
    user: { id },
  } as unknown as Session;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient();
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: makeSession() } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useCurrentUser', () => {
  it('セッションが無ければ query は無効でデータを取得しない', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useCurrentUser(), { wrapper });
    // session の解決を待つ。
    await waitFor(() => expect(result.current.sessionLoading).toBe(false));
    expect(result.current.session).toBeNull();
    expect(result.current.data).toBeUndefined();
  });

  it('セッションがあると /auth/me/sync を呼び profile を返す', async () => {
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json({
          data: {
            requiresProfileCompletion: false,
            user: {
              id: 'u1',
              email: 'a@example.com',
              fullName: '山田 太郎',
              displayName: 'タロ',
              primaryAuthMethod: 'password',
              createdAt: '2026-01-01T00:00:00Z',
            },
          },
        }),
      ),
    );

    const { result } = renderHook(() => useCurrentUser(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toMatchObject({
      requiresProfileCompletion: false,
      user: { id: 'u1', fullName: '山田 太郎' },
    });
    expect(result.current.error).toBeNull();
  });

  it('sync が失敗するとエラーを返す', async () => {
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'boom' } },
          { status: 500 },
        ),
      ),
    );

    const { result } = renderHook(() => useCurrentUser(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeUndefined();
  });
});
