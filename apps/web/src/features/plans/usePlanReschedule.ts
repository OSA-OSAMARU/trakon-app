import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api';
import { plansApi, plansQueryKey, type UpdatePlanInput } from './api';

export type ReschedulePatch = {
  itemId: string;
  planId: string;
  patch: UpdatePlanInput;
};

/**
 * ドラッグ移動 / リサイズによる日付変更を反映するフック。
 * 「後続もずらす」では複数プランを順次 PATCH する (BE に一括カスケード API が無いため)。
 * 完了後に横断プラン一覧 (projectList) を無効化して再取得する。
 */
export function useReschedulePlan(projectId: string) {
  const qc = useQueryClient();
  return useMutation<void, ApiClientError, ReschedulePatch[]>({
    mutationFn: async (patches) => {
      for (const p of patches) {
        await plansApi.update(projectId, p.itemId, p.planId, p.patch);
      }
    },
    onSuccess: () => toast.success('日程を更新しました'),
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '日程の更新に失敗しました'),
    onSettled: (_data, _err, patches) => {
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(projectId) });
      // 念のため per-item 一覧も無効化 (詳細モーダル等が参照)
      const itemIds = new Set(patches?.map((p) => p.itemId));
      for (const itemId of itemIds) {
        qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
      }
    },
  });
}
