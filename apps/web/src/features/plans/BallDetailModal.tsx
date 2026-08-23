import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Copy,
  CornerUpLeft,
  Link2Off,
  Loader2,
  MoreHorizontal,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RoleRow } from '@/components/trakon/RoleRow';
import { StatusPill } from '@/components/trakon/StatusPill';
import { WorkflowButton } from '@/components/trakon/WorkflowButton';
import { cn } from '@/components/ui/utils';
import { ApiClientError } from '@/lib/api';
import { useCurrentUser } from '@/features/auth/useCurrentUser';
import type { ProjectMember } from '@/features/projects/membersApi';
import { projectsApi, projectsQueryKey } from '@/features/projects/api';
import { plansApi, plansQueryKey, type BallEvent, type MemberRef, type Plan, type PlanState } from './api';
import { planCardStyle } from './planTheme';
import {
  useApprovePlan,
  useRequestReviewPlan,
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
  const [tab, setTab] = useState('overview');

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
            // 差し戻し=確認依頼の取り消しに集約。承認者/実施者/director が実施者へ戻せる。
            const canUndoReview =
              active && s === 'review_pending' && (isApprover || isExecutor || isDirector);
            const canToss = active && s === 'approved' && hasSuccessor && (isProgressManager || isDirector);
            const canUndoApprove = active && s === 'approved' && (isApprover || isProgressManager || isDirector);
            // TOSS 済み → 誰でも取り消せる (誤TOSS救済 #50)
            const canUndoToss = s === 'tossed';
            // 承認=完了 (後続なし) の取り消し
            const canUndoCompleted =
              plan.status === 'completed' && s !== 'tossed' && (isApprover || isProgressManager || isDirector);
            // 前工程へ差し戻し (§13): 確認依頼前 (実施中/差し戻し中) のみ、先行予定を再開できる。
            const canSendBackToPredecessor =
              active && inProgress && hasPredecessor && (isBallHolder || isDirector);
            const executorMissingHint =
              active && inProgress && !hasExecutor && (isExecutor || isDirector || myMember == null);

            const handleUnlink = () => successorMut.mutate({ itemId, planId, successorPlanId: null });
            const theme = planCardStyle(plan.category);

            /**
             * フッターに出す主要操作 (Figma node 39:14 は最大 2 つ)。
             * ボールを前へ進める操作と、実施者へ戻す操作だけをここに置く。
             */
            const primaryActions: {
              action: 'review-toss' | 'comment-return' | 'approve' | 'next-toss';
              label: string;
              onClick: () => void;
              pending: boolean;
            }[] = [];
            if (canUndoReview) {
              primaryActions.push({
                action: 'comment-return',
                label: 'ボールを戻す',
                onClick: () => undoRequestReviewMut.mutate(),
                pending: undoRequestReviewMut.isPending,
              });
            }
            if (canRequestReview) {
              primaryActions.push({
                action: 'review-toss',
                label: 'ボールを渡す',
                onClick: () => requestReviewMut.mutate(),
                pending: requestReviewMut.isPending,
              });
            }
            if (canApprove || canApproveByExecutor) {
              primaryActions.push({
                action: 'approve',
                label: hasSuccessor ? '承認' : '承認して完了',
                onClick: () => approveMut.mutate(),
                pending: approveMut.isPending,
              });
            }
            if (canToss) {
              primaryActions.push({
                action: 'next-toss',
                label: '次の工程へトス',
                onClick: () => tossMut.mutate(),
                pending: tossMut.isPending,
              });
            }

            /** 取り消し系・前工程への差し戻しはヘッダーの「⋯」へ寄せる。 */
            const secondaryActions: {
              label: string;
              icon: React.ReactNode;
              onSelect: () => void;
            }[] = [];
            if (canSendBackToPredecessor) {
              secondaryActions.push({
                label: '前工程へ差し戻す',
                icon: <Rewind />,
                onSelect: () => sendBackToPredecessorMut.mutate(),
              });
            }
            if (canUndoApprove) {
              secondaryActions.push({
                label: '承認を取り消す',
                icon: <Undo2 />,
                onSelect: () => undoApproveMut.mutate(),
              });
            }
            if (canUndoToss) {
              secondaryActions.push({
                label: 'TOSS を取り消す',
                icon: <Undo2 />,
                onSelect: () => undoTossMut.mutate(),
              });
            }
            if (canUndoCompleted) {
              secondaryActions.push({
                label: '完了を取り消す',
                icon: <Undo2 />,
                onSelect: () => undoApproveMut.mutate(),
              });
            }

            const footerHelper = executorMissingHint
              ? '実施者を設定すると操作できます'
              : plan.status === 'completed'
                ? 'この予定は完了しています'
                : plan.ballHolder
                  ? `${plan.ballHolder.name}さんの${STATE_LABEL[s]}`
                  : null;

            return (
              <>
                <SheetHeader className="gap-3">
                  <div className="flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <Badge shape="pill" size="lg" className={cn(theme.surface, 'text-plan-foreground border-transparent')}>
                        {theme.label}
                      </Badge>
                      <StatusPill status={plan.status === 'completed' ? 'completed' : s} hideIcon size="lg" />
                    </div>
                    {/* Figma は 編集 / 複製 / ⋯ を並べる。閉じるは Sheet 側が持つ */}
                    <div className="flex shrink-0 items-center gap-1">
                      {active && (
                        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="編集">
                          <Pencil className="size-5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => copyMut.mutate()}
                        disabled={copyMut.isPending}
                        aria-label="複製"
                      >
                        {copyMut.isPending ? (
                          <Loader2 className="size-5 animate-spin" />
                        ) : (
                          <Copy className="size-5" />
                        )}
                      </Button>
                      {secondaryActions.length > 0 || (active && events.length === 0) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="その他の操作">
                              <MoreHorizontal className="size-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {secondaryActions.map((a) => (
                              <DropdownMenuItem
                                key={a.label}
                                onSelect={a.onSelect}
                                disabled={anyPending}
                              >
                                {a.icon}
                                {a.label}
                              </DropdownMenuItem>
                            ))}
                            {active && events.length === 0 && (
                              <>
                                {secondaryActions.length > 0 && <DropdownMenuSeparator />}
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => setDeleting(true)}
                                >
                                  <Trash2 />
                                  削除
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </div>
                  <SheetTitle className="text-2xl font-bold">{plan.title}</SheetTitle>
                  <SheetDescription className="text-body">
                    {format(new Date(plan.scheduledDate), 'yyyy.M.d（E）', { locale: ja })}
                    {plan.dueDate &&
                      ` – ${format(new Date(plan.dueDate), 'M.d（E）', { locale: ja })}`}
                  </SheetDescription>
                </SheetHeader>

                <Tabs
                  value={tab}
                  onValueChange={setTab}
                  className="-mx-6 flex min-h-0 flex-1 flex-col"
                >
                  <TabsList className="border-border h-auto w-full justify-start gap-6 rounded-none border-b bg-transparent px-6 p-0">
                    <DrawerTab value="overview">概要</DrawerTab>
                    <DrawerTab value="history">履歴 {events.length}</DrawerTab>
                  </TabsList>

                  <TabsContent
                    value="overview"
                    className="flex-1 space-y-5 overflow-y-auto px-6 pt-5"
                  >
                    <Section title="現在のボール">
                      <BallHolderBanner plan={plan} />
                    </Section>

                    <Section title="担当">
                      <div className="border-border flex flex-col gap-3 rounded-xl border bg-background p-4">
                        <RoleRow
                          variant="detail"
                          role="executor"
                          name={plan.executor?.name ?? '未設定'}
                          caption={plan.executor?.organizationName ?? undefined}
                        />
                        <RoleRow
                          variant="detail"
                          role="approver"
                          name={plan.approver?.name ?? '未設定（実施者が承認）'}
                          caption={plan.approver?.organizationName ?? undefined}
                        />
                        <RoleRow
                          variant="detail"
                          role="manager"
                          name={plan.progressManager?.name ?? '未設定'}
                          caption={plan.progressManager?.organizationName ?? undefined}
                        />
                      </div>
                    </Section>

                    <Section title="スケジュール">
                      <div className="border-border grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border bg-background p-4">
                        <Field label="開始">
                          {format(new Date(plan.scheduledDate), 'yyyy.M.d（E）', { locale: ja })}
                        </Field>
                        <Field label="終了">
                          {plan.dueDate
                            ? format(new Date(plan.dueDate), 'yyyy.M.d（E）', { locale: ja })
                            : '—'}
                        </Field>
                        <Field label="工程">{theme.label}</Field>
                        <Field label="状態" emphasis>
                          {STATE_LABEL[s]}
                        </Field>
                      </div>
                    </Section>

                    {(plan.fromMember || plan.toMember) && (
                      <Section title="TOSS 履歴">
                        <p className="text-body">
                          {memberLabel(plan.fromMember)} <ArrowRight className="inline size-3.5" />{' '}
                          {memberLabel(plan.toMember)}
                        </p>
                      </Section>
                    )}

                    {plan.memo && (
                      <Section title="メモ">
                        <p className="border-border rounded-xl border bg-background p-4 text-body whitespace-pre-wrap">
                          {plan.memo}
                        </p>
                      </Section>
                    )}

                    {hasSuccessor && (
                      <Section title="次のTOSS">
                        <div className="border-border bg-toss-line-subtle flex items-center gap-3 rounded-xl border p-4">
                          <Send className="text-toss-line size-6 shrink-0" aria-hidden />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-bold">
                              {successor ? successor.title : '（別の制作物 / 取得中）'}
                            </span>
                            {successor && (
                              <span className="text-text-secondary truncate text-xs">
                                {format(new Date(successor.scheduledDate), 'M.d（E）', {
                                  locale: ja,
                                })}
                                開始
                                {successor.progressManager &&
                                  ` ・ 進行責任者 ${successor.progressManager.name}`}
                              </span>
                            )}
                          </span>
                          {plan.status === 'active' ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0"
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
                          ) : (
                            <ChevronRight className="text-toss-line size-5 shrink-0" aria-hidden />
                          )}
                        </div>
                      </Section>
                    )}

                    <Section
                      title="最近の履歴"
                      action={
                        events.length > 3 ? (
                          <button
                            type="button"
                            className="text-toss-line text-xs font-medium"
                            onClick={() => setTab('history')}
                          >
                            すべて見る
                          </button>
                        ) : null
                      }
                    >
                      <EventTimeline events={events.slice(0, 3)} compact />
                    </Section>
                  </TabsContent>

                  <TabsContent value="history" className="flex-1 overflow-y-auto px-6 pt-5">
                    <EventTimeline events={events} />
                  </TabsContent>
                </Tabs>

                <SheetFooter className="-mx-6 -mb-6 gap-3 border-t border-border px-6 pt-4 pb-6">
                  {footerHelper && (
                    <p className="text-text-secondary text-xs">{footerHelper}</p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {primaryActions.length > 0 ? (
                      primaryActions.map((a) => (
                        <WorkflowButton
                          key={a.label}
                          action={a.action}
                          onClick={a.onClick}
                          disabled={anyPending}
                        >
                          {a.pending ? <Loader2 className="size-4 animate-spin" /> : null}
                          {a.label}
                        </WorkflowButton>
                      ))
                    ) : (
                      <p className="text-text-tertiary text-xs">
                        いまこの予定で行える操作はありません。
                      </p>
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

function BallHolderBanner({
  plan,
}: {
  plan: {
    ballHolder: { name: string; organizationName: string } | null;
    ballState: PlanState;
    status: string;
  };
}) {
  const completed = plan.status === 'completed';
  const holder = plan.ballHolder;
  return (
    <div className="border-border bg-surface-subtle flex items-center gap-4 rounded-xl border p-4">
      <span
        aria-hidden
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full text-body font-bold',
          completed ? 'bg-success-subtle text-success' : 'bg-brand-subtle text-brand-strong',
        )}
      >
        {completed ? <CheckCircle2 className="size-4" /> : (holder?.name.trim().charAt(0) ?? '—')}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold">
          {completed ? '完了済み' : (holder?.name ?? '—')}
        </span>
        {!completed && holder?.organizationName && (
          <span className="text-text-secondary truncate text-xs">{holder.organizationName}</span>
        )}
      </span>
      <StatusPill
        status={completed ? 'completed' : plan.ballState}
        hideIcon
        size="lg"
        className="shrink-0"
      />
    </div>
  );
}

/** サイドモーダルのタブ (Figma node 37:25)。下線だけのシンプルな見た目にする。 */
function DrawerTab({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="data-[state=active]:border-foreground data-[state=active]:text-foreground text-text-secondary h-12 flex-none rounded-none border-b-2 border-transparent px-0 text-body font-medium data-[state=active]:bg-transparent data-[state=active]:font-bold"
    >
      {children}
    </TabsTrigger>
  );
}

/** スケジュール欄の 1 項目 (Figma node 38:29)。 */
function Field({
  label,
  emphasis,
  children,
}: {
  label: string;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-text-secondary w-10 shrink-0 text-xs">{label}</span>
      <span className={cn('min-w-0 text-body font-medium', emphasis && 'text-brand-strong')}>
        {children}
      </span>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-text-secondary text-xs font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
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
  if (type === 'tossed') return <Send className="text-toss-line mt-0.5 size-4 shrink-0" />;
  if (type === 'review_requested')
    return <ClipboardCheck className="text-brand-strong mt-0.5 size-4 shrink-0" />;
  if (type === 'approved' || type === 'completed')
    return <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" />;
  if (type === 'sent_back')
    return <CornerUpLeft className="text-danger mt-0.5 size-4 shrink-0" />;
  // *_undone は取り消し系
  return <Undo2 className="text-text-secondary mt-0.5 size-4 shrink-0" />;
}

function EventTimeline({ events, compact }: { events: BallEvent[]; compact?: boolean }) {
  if (events.length === 0) {
    return <p className="text-text-tertiary text-xs">まだイベントはありません。</p>;
  }
  if (compact) {
    // 概要タブの「最近の履歴」(Figma node 39:2): ドット + 文 + 時刻の 1 行
    return (
      <ol className="border-border flex flex-col gap-3 rounded-xl border bg-background p-4">
        {events.map((e) => (
          <li key={e.id} className="flex items-center gap-3 text-xs">
            <span className="bg-toss-line size-2 shrink-0 rounded-full" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {e.actor?.name ?? 'システム'}が{EVENT_LABEL[e.eventType]}しました
            </span>
            <span className="text-text-secondary shrink-0 text-tiny">
              {format(new Date(e.occurredAt), 'M.d HH:mm')}
            </span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="border-border flex flex-col divide-y divide-border rounded-xl border bg-background">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 p-4 text-body">
          <EventIcon type={e.eventType} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{EVENT_LABEL[e.eventType]}</span>
              {e.source === 'auto_chain' && (
                <Badge variant="neutral" size="sm">
                  <Zap />
                  自動連鎖
                </Badge>
              )}
              <span className="text-text-secondary text-xs">{e.actor?.name ?? 'システム'}</span>
            </span>
            {e.note && <span className="text-text-secondary text-xs">「{e.note}」</span>}
          </span>
          <span className="text-text-tertiary shrink-0 text-tiny">
            {format(new Date(e.occurredAt), 'yyyy.M.d HH:mm')}
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
