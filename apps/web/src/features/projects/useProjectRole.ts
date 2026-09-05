import { useQuery } from '@tanstack/react-query';

import {
  canPerformBallAction,
  canProjectRole,
  type ProjectAction,
  type ProjectRole,
} from '@trakon/shared';

import { projectsApi, projectsQueryKey } from './api';

/**
 * 自分のプロジェクトロールと、そこから導かれる操作可否をまとめて返す (設計書 §4.5)。
 *
 * Phase 0 では `project.role === 'admin'` の判定が画面ごとに散らばっていた。
 * ロールが 3 値になるとその分散は破綻するため、判定をこのフックに集約する。
 * 可否そのものは `packages/shared` のロール別操作マトリクス 1 箇所が持つ。
 */
export function useProjectRole(projectId: string | undefined) {
  const query = useQuery({
    queryKey: projectsQueryKey.detail(projectId ?? ''),
    queryFn: () => projectsApi.get(projectId as string),
    enabled: Boolean(projectId),
  });

  const role = (query.data?.role ?? null) as ProjectRole | null;

  return {
    role,
    isLoading: query.isLoading,
    isAdmin: role === 'admin',
    /** ロール単体で決まる操作の可否 */
    can: (action: ProjectAction) => (role ? canProjectRole(role, action) : false),
    /**
     * ボール操作の可否。ロール → 管理者なら通す → それ以外は保持者本人、の 2 段判定。
     */
    canBall: (action: 'plan.complete' | 'plan.toss', isHolder: boolean) =>
      role ? canPerformBallAction({ role, action, isHolder }) : false,
  };
}
