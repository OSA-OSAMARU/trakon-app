import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

// supabase をモックして getSession / onAuthStateChange を制御する。
const getSession = vi.fn();
const onAuthStateChange = vi.fn();
const unsubscribe = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChange(...args),
    },
  },
}));

import { useAuthSession } from './useAuthSession';

/** onAuthStateChange に渡されたコールバックを捕捉するためのホルダ。 */
let authCallback: ((event: string, session: Session | null) => void) | null = null;

function makeSession(id = 'u1'): Session {
  // 必要なプロパティだけ持つ最小セッション (型は as でキャスト)。
  return {
    access_token: 'tok',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'r',
    user: { id },
  } as unknown as Session;
}

beforeEach(() => {
  authCallback = null;
  getSession.mockReset();
  onAuthStateChange.mockReset();
  unsubscribe.mockReset();
  // デフォルト: コールバックを捕捉し、購読オブジェクトを返す。
  onAuthStateChange.mockImplementation(
    (cb: (event: string, session: Session | null) => void) => {
      authCallback = cb;
      return { data: { subscription: { unsubscribe } } };
    },
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAuthSession', () => {
  it('初期は isLoading=true (session=undefined) を返す', () => {
    // getSession は解決しない Promise にして初期状態を観測する。
    getSession.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAuthSession());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.session).toBeUndefined();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('getSession が null を返すと未認証 (isLoading=false) になる', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('getSession がセッションを返すと認証済みになる', async () => {
    getSession.mockResolvedValue({ data: { session: makeSession() } });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.session?.user.id).toBe('u1');
  });

  it('onAuthStateChange のコールバックで状態が遷移する (ログイン→ログアウト)', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);

    // ログイン通知
    act(() => authCallback?.('SIGNED_IN', makeSession('u2')));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.session?.user.id).toBe('u2');

    // ログアウト通知
    act(() => authCallback?.('SIGNED_OUT', null));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.session).toBeNull();
  });

  it('アンマウント時に subscription.unsubscribe を呼ぶ', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { unmount, result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
