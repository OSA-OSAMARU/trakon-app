import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { orgApi, orgQueryKey, type OrgMember } from './api';

/**
 * 組織メンバー一覧 (#202)。
 *
 * プロジェクト参加者はここから選ぶ。招待中 (未受諾) の人はまだアカウントが
 * 無く `userId` を持たないため、選択肢には出さない。
 */
export function useSelectableOrgMembers() {
  const query = useQuery({
    queryKey: orgQueryKey.members,
    queryFn: () => orgApi.listMembers(),
    staleTime: 30_000,
  });

  const members = useMemo(
    () => (query.data ?? []).filter((m): m is OrgMember & { userId: string } => !!m.userId),
    [query.data],
  );

  const byUserId = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members]);

  return { members, byUserId, isLoading: query.isLoading, error: query.error };
}

/** 選択肢に出す表示名。所属があれば添える。 */
export function orgMemberLabel(m: Pick<OrgMember, 'name' | 'organizationName'>): string {
  return m.organizationName ? `${m.name} / ${m.organizationName}` : m.name;
}
