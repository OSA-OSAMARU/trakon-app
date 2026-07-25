import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deriveBallHolder, type BallEventType } from '@trakon/shared';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api';
import { plansApi, plansQueryKey, type BallActionResult, type Plan } from './api';

/**
 * ボール操作 (#131: 確認依頼/承認/差し戻し/TOSS + 各取り消し) の楽観更新フック。
 * - onMutate で plans 一覧キャッシュを deriveBallHolder で先回り更新
 * - onError でロールバック
 * - onSettled で再フェッチ (BE 真値で正当化)
 *
 * 設計書 §4.7 Ball Holder 楽観更新
 */
function applyOptimistic(plan: Plan, eventType: BallEventType): Plan {
  const optimisticEvent = {
    eventType,
    source: 'human' as const,
    occurredAt: new Date().toISOString(),
  };
  const holder = deriveBallHolder(
    {
      executorMemberId: plan.executor?.id ?? null,
      approverMemberId: plan.approver?.id ?? null,
      progressManagerMemberId: plan.progressManager?.id ?? null,
      toMemberId: plan.toMember?.id ?? null,
      status: plan.status,
    },
    optimisticEvent,
  );
  const candidates = [plan.executor, plan.approver, plan.progressManager, plan.fromMember, plan.toMember];
  const newHolder = candidates.find((m) => m && m.id === holder.memberId) ?? null;

  // status の楽観更新: TOSS は先行完了、後続なしの承認は完了。
  let status = plan.status;
  if (eventType === 'tossed') status = 'completed';
  else if (eventType === 'approved') status = plan.successorPlanId ? 'active' : 'completed';
  else if (eventType === 'approval_undone' || eventType === 'toss_undone') status = 'active';

  return {
    ...plan,
    ballHolder: newHolder,
    ballState: holder.state,
    status,
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

type BallActionResponse = BallActionResult | { plan: Plan };

/**
 * ボール操作の汎用楽観更新フック。
 * optimisticEvent を渡すと onMutate で一覧キャッシュを先回り更新する。
 */
function useBallMutation(
  input: { projectId: string; itemId: string; planId: string },
  opts: {
    action: (projectId: string, itemId: string, planId: string) => Promise<BallActionResponse>;
    optimisticEvent?: BallEventType;
    successMsg: string;
    errorMsg: string;
  },
) {
  const qc = useQueryClient();
  const listKey = plansQueryKey.list(input.projectId, input.itemId);
  const detailKey = plansQueryKey.detail(input.projectId, input.itemId, input.planId);

  return useMutation<BallActionResponse, ApiClientError, void, { previousList?: Plan[] }>({
    mutationFn: () => opts.action(input.projectId, input.itemId, input.planId),
    onMutate: async () => {
      if (!opts.optimisticEvent) return {};
      await qc.cancelQueries({ queryKey: listKey });
      const previousList = qc.getQueryData<Plan[]>(listKey);
      if (previousList) {
        qc.setQueryData<Plan[]>(
          listKey,
          previousList.map((p) =>
            p.id === input.planId ? applyOptimistic(p, opts.optimisticEvent!) : p,
          ),
        );
      }
      return { previousList };
    },
    onError: (err, _vars, context) => {
      if (context?.previousList) qc.setQueryData(listKey, context.previousList);
      toast.error(err instanceof ApiClientError ? err.message : opts.errorMsg);
    },
    onSuccess: () => {
      toast.success(opts.successMsg);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(input.projectId) });
    },
  });
}

export function useRequestReviewPlan(input: { projectId: string; itemId: string; planId: string }) {
  return useBallMutation(input, {
    action: plansApi.requestReview,
    optimisticEvent: 'review_requested',
    successMsg: '確認を依頼しました',
    errorMsg: '確認依頼に失敗しました',
  });
}

export function useApprovePlan(input: { projectId: string; itemId: string; planId: string }) {
  return useBallMutation(input, {
    action: plansApi.approve,
    optimisticEvent: 'approved',
    successMsg: '承認しました',
    errorMsg: '承認に失敗しました',
  });
}

export function useSendBackPlan(input: { projectId: string; itemId: string; planId: string }) {
  return useBallMutation(input, {
    action: (p, i, pl) => plansApi.sendBack(p, i, pl),
    optimisticEvent: 'sent_back',
    successMsg: '差し戻しました',
    errorMsg: '差し戻しに失敗しました',
  });
}

export function useTossPlan(input: { projectId: string; itemId: string; planId: string }) {
  return useBallMutation(input, {
    action: plansApi.toss,
    optimisticEvent: 'tossed',
    successMsg: 'TOSS しました',
    errorMsg: 'TOSS に失敗しました',
  });
}

export function useUndoRequestReviewPlan(input: { projectId: string; itemId: string; planId: string }) {
  return useBallMutation(input, {
    action: plansApi.undoRequestReview,
    optimisticEvent: 'review_request_undone',
    successMsg: '確認依頼を取り消しました',
    errorMsg: '取り消しに失敗しました',
  });
}

export function useUndoApprovePlan(input: { projectId: string; itemId: string; planId: string }) {
  return useBallMutation(input, {
    action: plansApi.undoApprove,
    optimisticEvent: 'approval_undone',
    successMsg: '承認を取り消しました',
    errorMsg: '取り消しに失敗しました',
  });
}

export function useUndoTossPlan(input: { projectId: string; itemId: string; planId: string }) {
  return useBallMutation(input, {
    action: plansApi.undoToss,
    optimisticEvent: 'toss_undone',
    successMsg: 'TOSS を取り消しました',
    errorMsg: '取り消しに失敗しました',
  });
}

/**
 * 前工程へ差し戻し (#131 §13)。後続予定と先行予定の両方が変化するため楽観更新はせず、
 * onSuccess で一覧/詳細を再フェッチする。
 */
export function useSendBackToPredecessorPlan(input: {
  projectId: string;
  itemId: string;
  planId: string;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      plansApi.sendBackToPredecessor(input.projectId, input.itemId, input.planId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: plansQueryKey.list(input.projectId, input.itemId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.detail(input.projectId, input.itemId, input.planId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(input.projectId) });
      toast.success('前工程へ差し戻しました');
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : '前工程への差し戻しに失敗しました'),
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
