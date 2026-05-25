import { useQuery } from '@tanstack/react-query';

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

  return {
    session,
    sessionLoading,
    data: query.data,
    isLoading: sessionLoading || query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
