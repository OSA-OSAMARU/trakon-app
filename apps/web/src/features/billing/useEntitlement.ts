import { useQuery } from '@tanstack/react-query';

import { billingApi, billingQueryKey } from './api';

/**
 * 契約状態・利用権限・上限・凍結対象を取得する (設計書 §4.5)。
 *
 * **利用権限はフロントエンドで再計算しない。** バックエンドが返した判定結果を
 * そのまま表示に使う。二重実装は必ずずれるため (§7.6.4)。
 */
export function useEntitlement() {
  const query = useQuery({
    queryKey: billingQueryKey.subscription,
    queryFn: () => billingApi.get(),
    staleTime: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    entitlement: query.data?.entitlement ?? null,
    subscription: query.data?.subscription ?? null,
    /** 課金操作 (契約・変更・解約) ができるか */
    canManageBilling: query.data?.orgRole === 'owner' || query.data?.orgRole === 'admin',
    frozenProjectIds: query.data?.frozenProjectIds ?? [],
    refetch: query.refetch,
  };
}
