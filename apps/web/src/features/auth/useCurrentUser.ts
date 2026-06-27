import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { ApiClientError } from '@/lib/api';
import { authApi, type SyncResponse } from './api';
import { useAuthSession } from './useAuthSession';

/**
 * 認証済みセッションがある場合に `/auth/me/sync` を呼び、
 * users 行 + 詳細入力要否を取得する。
 */
export function useCurrentUser() {
  const { session, isLoading: sessionLoading } = useAuthSession();

  const query = useQuery<SyncResponse>({
    queryKey: ['auth', 'sync', session?.user.id],
    queryFn: authApi.syncMe,
    enabled: !!session,
    staleTime: 60_000,
    retry: 0,
  });

  // stale セッションの自己回復: sync が 401 (AUTH_MISSING/AUTH_INVALID) を返したら
  // その JWT はサーバー側で無効 (退会済み・削除済み等) なのでローカルセッションを破棄する。
  // これにより RequireAuth / AuthCallbackPage は !session 分岐で /login へ収束し、
  // sync(401) + 404 の無限ループを断ち切る。signOut で query は無効化され再 fetch しない。
  const error = query.error;
  useEffect(() => {
    if (error instanceof ApiClientError && error.status === 401) {
      void supabase.auth.signOut({ scope: 'local' });
    }
  }, [error]);

  return {
    session,
    sessionLoading,
    data: query.data,
    isLoading: sessionLoading || query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
