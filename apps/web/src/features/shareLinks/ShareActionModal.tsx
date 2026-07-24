import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CheckCircle2, ClipboardCheck, CornerUpLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ApiClientError } from '@/lib/api';
import { CATEGORY_STYLE } from '@/features/plans/categoryColor';
import type { MemberRef, Plan, PlanState } from '@/features/plans/api';
import { shareAccessApi } from './api';

const STATE_LABEL: Record<PlanState, string> = {
  in_progress: '実施中',
  review_pending: '確認待ち',
  approved: '承認済み・TOSS待ち',
  tossed: 'TOSS済み',
  sent_back: '差し戻し',
  completed: '完了',
};

/**
 * 共有リンク (非会員=クライアント) 向けの操作モーダル (#131)。
 *  - 確認依頼 / 承認 / 差し戻し のみ (状態で出し分け)。
 *  - 進行責任者の TOSS(次工程へ進める操作)はクライアントには提供しない。
 */
export function ShareActionModal({
  token,
  plan,
  onClose,
}: {
  token: string;
  plan: Plan;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const style = CATEGORY_STYLE[plan.category];

  const makeHandlers = (okMsg: string) => ({
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['share', token] });
      toast.success(okMsg);
      onClose();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof ApiClientError ? e.message : '操作に失敗しました'),
  });

  const requestReviewMut = useMutation({
    mutationFn: () => shareAccessApi.requestReview(token, plan.id),
    ...makeHandlers('確認を依頼しました'),
  });
  const approveMut = useMutation({
    mutationFn: () => shareAccessApi.approve(token, plan.id),
    ...makeHandlers('承認しました'),
  });
  const sendBackMut = useMutation({
    mutationFn: () => shareAccessApi.sendBack(token, plan.id),
    ...makeHandlers('差し戻しました'),
  });
  const pending = requestReviewMut.isPending || approveMut.isPending || sendBackMut.isPending;

  const s = plan.ballState;
  const active = plan.status === 'active';
  const hasApprover = !!plan.approver;
  const inProgress = s === 'in_progress' || s === 'sent_back';
  const hasSuccessor = plan.successorPlanId !== null;

  const canRequestReview = active && inProgress && hasApprover && !!plan.executor;
  const canApproveDirect = active && inProgress && !hasApprover && !!plan.executor;
  const canApprove = active && s === 'review_pending';
  const canSendBack = active && s === 'review_pending';
  const noAction = !canRequestReview && !canApproveDirect && !canApprove && !canSendBack;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Badge variant="secondary" className={`${style.bg} ${style.text}`}>
              {style.label}
            </Badge>
            {plan.title}
          </SheetTitle>
          <SheetDescription>
            {format(new Date(plan.scheduledDate), 'yyyy/M/d')}
            {plan.dueDate && ` 〜 期日 ${format(new Date(plan.dueDate), 'yyyy/M/d')}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto text-sm">
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs">
            <span className="text-muted-foreground">現在のホルダー</span>
            <span className="font-medium">{plan.ballHolder?.name ?? '—'}</span>
            <Badge variant="secondary" className="ml-auto">
              {STATE_LABEL[plan.ballState]}
            </Badge>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">実施者</dt>
            <dd>{memberLabel(plan.executor)}</dd>
            <dt className="text-muted-foreground">承認者</dt>
            <dd>{plan.approver ? memberLabel(plan.approver) : '未設定 (実施者が承認)'}</dd>
          </dl>
          {plan.memo && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
              {plan.memo}
            </div>
          )}
          {noAction && (
            <p className="text-xs text-muted-foreground">
              この予定に対してクライアントが行える操作はありません。
            </p>
          )}
        </div>

        <SheetFooter className="flex-row flex-wrap justify-end gap-2">
          {canRequestReview && (
            <Button onClick={() => requestReviewMut.mutate()} disabled={pending}>
              {requestReviewMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ClipboardCheck className="size-4" />
              )}
              確認依頼
            </Button>
          )}
          {canSendBack && (
            <Button variant="outline" onClick={() => sendBackMut.mutate()} disabled={pending}>
              {sendBackMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CornerUpLeft className="size-4" />
              )}
              差し戻す
            </Button>
          )}
          {(canApprove || canApproveDirect) && (
            <Button onClick={() => approveMut.mutate()} disabled={pending}>
              {approveMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {hasSuccessor ? '承認' : '承認して完了'}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function memberLabel(m: MemberRef | null): string {
  return m ? `${m.name} (${m.organizationName || '—'})` : '—';
}
