import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  CornerUpLeft,
  Link2Off,
  Loader2,
  Pencil,
  Rewind,
  Send,
  Trash2,
  Undo2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api';
import { useCurrentUser } from '@/features/auth/useCurrentUser';
import type { ProjectMember } from '@/features/projects/membersApi';
import { projectsApi, projectsQueryKey } from '@/features/projects/api';
import { plansApi, plansQueryKey, type BallEvent, type MemberRef, type Plan, type PlanState } from './api';
import { CATEGORY_STYLE } from './categoryColor';
import {
  useApprovePlan,
  useRequestReviewPlan,
  useSendBackPlan,
  useSendBackToPredecessorPlan,
  useSetSuccessor,
  useTossPlan,
  useUndoApprovePlan,
  useUndoRequestReviewPlan,
  useUndoTossPlan,
} from './useOptimisticBallAction';

const STATE_LABEL: Record<PlanState, string> = {
  in_progress: '実施中',
  review_pending: '確認待ち',
  approved: '承認済み・TOSS待ち',
  tossed: 'TOSS済み',
  sent_back: '差し戻し',
  completed: '完了',
};

/**
 * SC-08 ボール詳細・操作モーダル (#131 の役割別状態機械)。
 *  - 状態: 実施中 → 確認待ち → 承認済み → TOSS済み / 差し戻し
 *  - 操作は役割 (実施者 / 承認者 / 進行責任者) 別に出し分ける。director は常に操作可。
 */
export function BallDetailModal({
  projectId,
  itemId,
  planId,
  members,
  plans,
  onClose,
  onEdit,
  onCopied,
}: {
  projectId: string;
  itemId: string;
  planId: string;
  members: ProjectMember[];
  plans: Plan[];
  onClose: () => void;
  onEdit: () => void;
  onCopied: (newPlanId: string) => void;
}) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  const { data: currentUser } = useCurrentUser();
  const myUserId = currentUser && !currentUser.requiresProfileCompletion ? currentUser.user.id : null;
  const myMember = members.find((m) => m.userId === myUserId);

  const detailQuery = useQuery({
    queryKey: plansQueryKey.detail(projectId, itemId, planId),
    queryFn: () => plansApi.get(projectId, itemId, planId),
  });

  const projectQuery = useQuery({
    queryKey: projectsQueryKey.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });
  const isDirector = projectQuery.data?.role === 'director';

  const requestReviewMut = useRequestReviewPlan({ projectId, itemId, planId });
  const undoRequestReviewMut = useUndoRequestReviewPlan({ projectId, itemId, planId });
  const approveMut = useApprovePlan({ projectId, itemId, planId });
  const undoApproveMut = useUndoApprovePlan({ projectId, itemId, planId });
  const sendBackMut = useSendBackPlan({ projectId, itemId, planId });
  const sendBackToPredecessorMut = useSendBackToPredecessorPlan({ projectId, itemId, planId });
  const tossMut = useTossPlan({ projectId, itemId, planId });
  const undoTossMut = useUndoTossPlan({ projectId, itemId, planId });
  const successorMut = useSetSuccessor(projectId);

  const copyMut = useMutation({
    mutationFn: () => plansApi.copy(projectId, itemId, planId),
    onSuccess: (newPlan) => {
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(projectId) });
      toast.success('複製しました');
      onCopied(newPlan.id);
    },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : '複製に失敗しました'),
  });

  const deleteMut = useMutation({
    mutationFn: () => plansApi.remove(projectId, itemId, planId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(projectId) });
      toast.success('予定を削除しました');
      setDeleting(false);
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : '削除に失敗しました'),
  });

  const anyPending =
    requestReviewMut.isPending ||
    undoRequestReviewMut.isPending ||
    approveMut.isPending ||
    undoApproveMut.isPending ||
    sendBackMut.isPending ||
    sendBackToPredecessorMut.isPending ||
    tossMut.isPending ||
    undoTossMut.isPending;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        {detailQuery.isLoading && <DetailSkeleton />}
        {detailQuery.error && (
          <SheetHeader>
            <SheetTitle>取得に失敗しました</SheetTitle>
            <SheetDescription>時間をおいて再度お試しください。</SheetDescription>
          </SheetHeader>
        )}
        {detailQuery.data &&
          (() => {
            const { plan, events } = detailQuery.data;
            const s = plan.ballState;
            const active = plan.status === 'active';
            const hasApprover = !!plan.approver;
            const hasExecutor = !!plan.executor;
            const hasSuccessor = plan.successorPlanId !== null;
            const style = CATEGORY_STYLE[plan.category];
            const successor = plan.successorPlanId
              ? (plans.find((p) => p.id === plan.successorPlanId) ?? null)
              : null;

            const isExecutor = !!myMember && plan.executor?.id === myMember.id;
            const isApprover = !!myMember && plan.approver?.id === myMember.id;
            const isProgressManager = !!myMember && plan.progressManager?.id === myMember.id;
            const isBallHolder = !!myMember && plan.ballHolder?.id === myMember.id;
            // 先行予定 = この予定を後続に指す予定 (successorPlanId は UNIQUE のため最大1件)。
            const hasPredecessor = plans.some((p) => p.successorPlanId === plan.id);

            // 操作の可否 (役割 + 状態)
            const inProgress = s === 'in_progress' || s === 'sent_back';
            const canRequestReview = active && inProgress && hasApprover && hasExecutor && (isExecutor || isDirector);
            const canApproveByExecutor = active && inProgress && !hasApprover && hasExecutor && (isExecutor || isDirector);
            const canApprove = active && s === 'review_pending' && (isApprover || isDirector);
            const canSendBack = active && s === 'review_pending' && (isApprover || isDirector);
            const canToss = active && s === 'approved' && hasSuccessor && (isProgressManager || isDirector);
            const canUndoApprove = active && s === 'approved' && (isApprover || isProgressManager || isDirector);
            // TOSS 済み → 誰でも取り消せる (誤TOSS救済 #50)
            const canUndoToss = s === 'tossed';
            // 承認=完了 (後続なし) の取り消し
            const canUndoCompleted =
              plan.status === 'completed' && s !== 'tossed' && (isApprover || isProgressManager || isDirector);
            // 前工程へ差し戻し (§13): 後続予定の実施中/確認待ちから先行予定を再開。
            const canSendBackToPredecessor =
              active &&
              (s === 'in_progress' || s === 'review_pending') &&
              hasPredecessor &&
              (isBallHolder || isDirector);
            const executorMissingHint =
              active && inProgress && !hasExecutor && (isExecutor || isDirector || myMember == null);

            const handleUnlink = () => successorMut.mutate({ itemId, planId, successorPlanId: null });

            return (
              <>
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
                  <BallHolderBanner plan={plan} />

                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">開始日</dt>
                    <dd>{format(new Date(plan.scheduledDate), 'yyyy/M/d')}</dd>
                    <dt className="text-muted-foreground">終了日</dt>
                    <dd>{plan.dueDate ? format(new Date(plan.dueDate), 'yyyy/M/d') : '—'}</dd>
                    <dt className="text-muted-foreground">実施者</dt>
                    <dd>{memberLabel(plan.executor)}</dd>
                    <dt className="text-muted-foreground">承認者</dt>
                    <dd>{plan.approver ? memberLabel(plan.approver) : '未設定 (実施者が承認)'}</dd>
                    <dt className="text-muted-foreground">進行責任者</dt>
                    <dd>{memberLabel(plan.progressManager)}</dd>
                    {(plan.fromMember || plan.toMember) && (
                      <>
                        <dt className="text-muted-foreground">TOSS履歴</dt>
                        <dd>
                          {memberLabel(plan.fromMember)} <ArrowRight className="inline size-3" />{' '}
                          {memberLabel(plan.toMember)}
                        </dd>
                      </>
                    )}
                  </dl>
                  {plan.memo && (
                    <div className="rounded-md border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                      {plan.memo}
                    </div>
                  )}
                  {hasSuccessor && (
                    <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">
                      <ArrowRight className="size-4 shrink-0" />
                      <span className="shrink-0 text-sky-600">次のタスク</span>
                      <span className="truncate font-medium">
                        {successor ? successor.title : '（別の制作物 / 取得中）'}
                      </span>
                      {plan.status === 'active' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="ml-auto size-7 shrink-0 text-sky-700 hover:text-sky-900"
                          onClick={handleUnlink}
                          disabled={successorMut.isPending}
                          aria-label="後続の紐づけを解除"
                          title="後続の紐づけを解除"
                        >
                          {successorMut.isPending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Link2Off className="size-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  )}
                  <Section title="履歴">
                    <EventTimeline events={events} />
                  </Section>
                </div>

                <SheetFooter className="flex-row items-center justify-between">
                  <div className="flex gap-1">
                    {plan.status === 'active' && (
                      <Button variant="ghost" size="icon" onClick={onEdit} aria-label="編集">
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyMut.mutate()}
                      disabled={copyMut.isPending}
                      aria-label="複製"
                      title="複製"
                    >
                      {copyMut.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                    {plan.status === 'active' && events.length === 0 && (
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(true)} aria-label="削除">
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {executorMissingHint && (
                      <span className="self-center text-[11px] text-muted-foreground">
                        実施者を設定すると操作できます
                      </span>
                    )}
                    {canRequestReview && (
                      <ActionButton
                        onClick={() => requestReviewMut.mutate()}
                        pending={requestReviewMut.isPending}
                        disabled={anyPending}
                        icon={<ClipboardCheck className="size-4" />}
                        label="確認依頼"
                      />
                    )}
                    {canApproveByExecutor && (
                      <ActionButton
                        onClick={() => approveMut.mutate()}
                        pending={approveMut.isPending}
                        disabled={anyPending}
                        icon={<CheckCircle2 className="size-4" />}
                        label={hasSuccessor ? '承認' : '完了'}
                      />
                    )}
                    {canSendBack && (
                      <ActionButton
                        variant="outline"
                        onClick={() => sendBackMut.mutate()}
                        pending={sendBackMut.isPending}
                        disabled={anyPending}
                        icon={<CornerUpLeft className="size-4" />}
                        label="差し戻す"
                      />
                    )}
                    {canSendBackToPredecessor && (
                      <ActionButton
                        variant="outline"
                        onClick={() => sendBackToPredecessorMut.mutate()}
                        pending={sendBackToPredecessorMut.isPending}
                        disabled={anyPending}
                        icon={<Rewind className="size-4" />}
                        label="前工程へ差し戻す"
                      />
                    )}
                    {canApprove && (
                      <ActionButton
                        onClick={() => approveMut.mutate()}
                        pending={approveMut.isPending}
                        disabled={anyPending}
                        icon={<CheckCircle2 className="size-4" />}
                        label={hasSuccessor ? '承認' : '承認して完了'}
                      />
                    )}
                    {canToss && (
                      <ActionButton
                        onClick={() => tossMut.mutate()}
                        pending={tossMut.isPending}
                        disabled={anyPending}
                        icon={<Send className="size-4" />}
                        label="TOSS"
                      />
                    )}
                    {canUndoApprove && (
                      <ActionButton
                        variant="outline"
                        onClick={() => undoApproveMut.mutate()}
                        pending={undoApproveMut.isPending}
                        disabled={anyPending}
                        icon={<Undo2 className="size-4" />}
                        label="承認を取り消す"
                      />
                    )}
                    {/* 確認待ちで実施者/director が誤依頼を取り消す */}
                    {active && s === 'review_pending' && (isExecutor || isDirector) && (
                      <ActionButton
                        variant="outline"
                        onClick={() => undoRequestReviewMut.mutate()}
                        pending={undoRequestReviewMut.isPending}
                        disabled={anyPending}
                        icon={<Undo2 className="size-4" />}
                        label="確認依頼を取り消す"
                      />
                    )}
                    {canUndoToss && (
                      <ActionButton
                        variant="outline"
                        onClick={() => undoTossMut.mutate()}
                        pending={undoTossMut.isPending}
                        disabled={anyPending}
                        icon={<Undo2 className="size-4" />}
                        label="TOSS を取り消す"
                      />
                    )}
                    {canUndoCompleted && (
                      <ActionButton
                        variant="outline"
                        onClick={() => undoApproveMut.mutate()}
                        pending={undoApproveMut.isPending}
                        disabled={anyPending}
                        icon={<Undo2 className="size-4" />}
                        label="完了を取り消す"
                      />
                    )}
                  </div>
                </SheetFooter>
              </>
            );
          })()}
      </SheetContent>

      <AlertDialog open={deleting} onOpenChange={(o) => !o && setDeleting(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>予定を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>この操作は取り消せません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMut.mutate();
              }}
              disabled={deleteMut.isPending}
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function memberLabel(m: MemberRef | null): string {
  return m ? `${m.name} (${m.organizationName || '—'})` : '—';
}

function ActionButton({
  onClick,
  pending,
  disabled,
  icon,
  label,
  variant,
}: {
  onClick: () => void;
  pending: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  variant?: 'outline';
}) {
  return (
    <Button variant={variant} onClick={onClick} disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : icon}
      {label}
    </Button>
  );
}

function BallHolderBanner({
  plan,
}: {
  plan: { ballHolder: { name: string } | null; ballState: PlanState; status: string };
}) {
  if (plan.status === 'completed') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-700">
        <CheckCircle2 className="size-4" /> 完了済み
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs">
      <span className="text-muted-foreground">現在のホルダー</span>
      <span className="font-medium">{plan.ballHolder?.name ?? '—'}</span>
      <Badge variant="secondary" className="ml-auto">
        {STATE_LABEL[plan.ballState]}
      </Badge>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

const EVENT_LABEL: Record<BallEvent['eventType'], string> = {
  review_requested: '確認依頼',
  approved: '承認',
  sent_back: '差し戻し',
  review_request_undone: '確認依頼の取り消し',
  approval_undone: '承認の取り消し',
  tossed: 'TOSS',
  completed: '完了',
  toss_undone: 'TOSS の取り消し',
  completion_undone: '完了の取り消し',
};

function EventIcon({ type }: { type: BallEvent['eventType'] }) {
  if (type === 'tossed') return <Send className="size-3.5 text-sky-600" />;
  if (type === 'review_requested') return <ClipboardCheck className="size-3.5 text-violet-600" />;
  if (type === 'approved' || type === 'completed')
    return <CheckCircle2 className="size-3.5 text-emerald-600" />;
  if (type === 'sent_back') return <CornerUpLeft className="size-3.5 text-amber-600" />;
  // *_undone は取り消し系
  return <Undo2 className="size-3.5 text-amber-600" />;
}

function EventTimeline({ events }: { events: BallEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-muted-foreground">まだイベントはありません。</p>;
  }
  return (
    <ol className="space-y-1.5">
      {events.map((e) => (
        <li
          key={e.id}
          className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
        >
          <EventIcon type={e.eventType} />
          <span className="font-medium">{EVENT_LABEL[e.eventType]}</span>
          {e.source === 'auto_chain' && (
            <Badge variant="secondary" className="px-1 py-0 text-[10px]">
              <Zap className="size-3" />
              自動連鎖
            </Badge>
          )}
          <span className="text-muted-foreground">by {e.actor?.name ?? 'system'}</span>
          {e.note && <span className="truncate text-muted-foreground">「{e.note}」</span>}
          <span className="ml-auto shrink-0 text-muted-foreground">
            {format(new Date(e.occurredAt), 'yyyy/M/d HH:mm')}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
