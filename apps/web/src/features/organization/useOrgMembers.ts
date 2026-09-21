import { useQuery } from '@tanstack/react-query';

import { orgApi, orgQueryKey, type MemberCandidate } from './api';

/**
 * 参加者に選べる組織メンバー (#202 / #238)。
 *
 * 候補はサーバーが絞る。招待中 (未受諾) の人はまだアカウントが無いので出てこない。
 * 候補が空のときに理由を言い分けられるよう、除外された人数も一緒に受け取る。
 */
export function useSelectableOrgMembers() {
  const query = useQuery({
    queryKey: orgQueryKey.candidates,
    queryFn: () => orgApi.listCandidates(),
    staleTime: 30_000,
  });

  const members = query.data?.candidates ?? [];
  const byUserId = new Map(members.map((m) => [m.userId, m]));

  return {
    members,
    byUserId,
    pendingCount: query.data?.pendingCount ?? 0,
    joinedCount: query.data?.joinedCount ?? 0,
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** 選択肢に出す表示名。所属があれば添える。 */
export function orgMemberLabel(m: Pick<MemberCandidate, 'name' | 'organizationName'>): string {
  return m.organizationName ? `${m.name} / ${m.organizationName}` : m.name;
}
