import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deriveBallHolder } from '@trakon/shared';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api';
import { plansApi, plansQueryKey, type BallActionResult, type Plan } from './api';

/**
 * TOSS / 完了の楽観更新フック。
 * - onMutate で plans 一覧キャッシュを deriveBallHolder で先回り更新
 * - onError でロールバック
 * - onSettled で再フェッチ (BE 真値で正当化)
 *
 * 設計書 §4.7 Ball Holder 楽観更新
 */
function applyOptimistic(plan: Plan, eventType: 'tossed' | 'completed'): Plan {
  const optimisticEvent = {
    eventType,
    source: 'human' as const,
    occurredAt: new Date().toISOString(),
  };
  const holder = deriveBallHolder(
    {
      fromMemberId: plan.fromMember?.id ?? null,
      toMemberId: plan.toMember?.id ?? null,
      status: plan.status,
    },
    optimisticEvent,
  );
  const newHolder =
    holder.memberId === plan.fromMember?.id
      ? plan.fromMember
      : holder.memberId === plan.toMember?.id
        ? plan.toMember
        : null;
  return {
    ...plan,
    ballHolder: newHolder,
    ballState: holder.state,
    status: eventType === 'completed' ? 'completed' : plan.status,
    latestEvent: {
      id: 'optimistic',
      eventType,
      source: 'human',
      actor: null,
      occurredAt: optimisticEvent.occurredAt,
      note: null,
    },
  };
}

export function useTossPlan(input: { projectId: string; itemId: string; planId: string }) {
  const qc = useQueryClient();
  const listKey = plansQueryKey.list(input.projectId, input.itemId);
  const detailKey = plansQueryKey.detail(input.projectId, input.itemId, input.planId);

  return useMutation<BallActionResult, ApiClientError, { toMemberId?: string } | undefined, { previousList?: Plan[] }>({
    mutationFn: (body) => plansApi.toss(input.projectId, input.itemId, input.planId, body),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: listKey });
      const previousList = qc.getQueryData<Plan[]>(listKey);
      if (previousList) {
        qc.setQueryData<Plan[]>(
          listKey,
          previousList.map((p) =>
            p.id === input.planId ? applyOptimistic(p, 'tossed') : p,
          ),
        );
      }
      return { previousList };
    },
    onError: (err, _vars, context) => {
      if (context?.previousList) {
        qc.setQueryData(listKey, context.previousList);
      }
      toast.error(err instanceof ApiClientError ? err.message : 'TOSS に失敗しました');
    },
    onSuccess: () => {
      toast.success('TOSS しました');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(input.projectId) });
    },
  });
}

/**
 * 後続予定 (successorPlanId) の紐づけ / 解除。
 * - スケジュールのドラッグ紐づけ・モーダルの解除で共用するため projectId のみ固定し、
 *   itemId / planId / successorPlanId は mutate 引数で受ける。
 * - 楽観更新はせず onSuccess で再フェッチ (BE 真値で正当化)。
 */
export function useSetSuccessor(projectId: string) {
  const qc = useQueryClient();
  return useMutation<
    Plan,
    ApiClientError,
    { itemId: string; planId: string; successorPlanId: string | null }
  >({
    mutationFn: ({ itemId, planId, successorPlanId }) =>
      plansApi.setSuccessor(projectId, itemId, planId, successorPlanId),
    onSuccess: (_plan, { itemId, planId, successorPlanId }) => {
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.detail(projectId, itemId, planId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(projectId) });
      toast.success(successorPlanId ? '後続を紐づけました' : '後続の紐づけを解除しました');
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : '後続の更新に失敗しました'),
  });
}

export function useCompletePlan(input: { projectId: string; itemId: string; planId: string }) {
  const qc = useQueryClient();
  const listKey = plansQueryKey.list(input.projectId, input.itemId);
  const detailKey = plansQueryKey.detail(input.projectId, input.itemId, input.planId);

  return useMutation<BallActionResult, ApiClientError, void, { previousList?: Plan[] }>({
    mutationFn: () => plansApi.complete(input.projectId, input.itemId, input.planId),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: listKey });
      const previousList = qc.getQueryData<Plan[]>(listKey);
      if (previousList) {
        qc.setQueryData<Plan[]>(
          listKey,
          previousList.map((p) =>
            p.id === input.planId ? applyOptimistic(p, 'completed') : p,
          ),
        );
      }
      return { previousList };
    },
    onError: (err, _vars, context) => {
      if (context?.previousList) {
        qc.setQueryData(listKey, context.previousList);
      }
      toast.error(err instanceof ApiClientError ? err.message : '完了に失敗しました');
    },
    onSuccess: (result) => {
      toast.success('完了しました');
      if (result.autoTossed) {
        toast.message('後続の予定に自動 TOSS しました');
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(input.projectId) });
    },
  });
}
