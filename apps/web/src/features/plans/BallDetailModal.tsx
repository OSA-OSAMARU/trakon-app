import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowRight, CheckCircle2, Link2Off, Loader2, Pencil, Send, Trash2, Undo2, Zap } from 'lucide-react';
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
import { plansApi, plansQueryKey, type BallEvent, type Plan } from './api';
import { CATEGORY_STYLE } from './categoryColor';
import { useCompletePlan, useSetSuccessor, useTossPlan } from './useOptimisticBallAction';

/**
 * SC-08 ボール詳細・TOSS/完了モーダル
 *  - ボール状態・履歴表示
 *  - 認可: Ball Holder 本人 or ディレクター
 */
export function BallDetailModal({
  projectId,
  itemId,
  planId,
  members,
  plans,
  onClose,
  onEdit,
}: {
  projectId: string;
  itemId: string;
  planId: string;
  members: ProjectMember[];
  plans: Plan[];
  onClose: () => void;
  onEdit: () => void;
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

  // ディレクター (プロジェクト作成者) は保持者でなくてもトス/完了できる。
  // スケジュール側では同じ query key で既に取得済みのためキャッシュヒットになる。
  const projectQuery = useQuery({
    queryKey: projectsQueryKey.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });
  const isDirector = projectQuery.data?.role === 'director';

  const tossMut = useTossPlan({ projectId, itemId, planId });
  const completeMut = useCompletePlan({ projectId, itemId, planId });
  const successorMut = useSetSuccessor(projectId);

  const undoMut = useMutation({
    mutationFn: () => plansApi.undoToss(projectId, itemId, planId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(projectId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.detail(projectId, itemId, planId) });
      toast.success('差し戻しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '差し戻しに失敗しました'),
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
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '削除に失敗しました'),
  });

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
            const isBallHolder =
              !!plan.ballHolder && !!myMember && plan.ballHolder.id === myMember.id;
            const canAct = plan.status === 'active' && (isBallHolder || isDirector);
            const style = CATEGORY_STYLE[plan.category];
            const successor = plan.successorPlanId
              ? (plans.find((p) => p.id === plan.successorPlanId) ?? null)
              : null;
            const hasSuccessor = plan.successorPlanId !== null;

            const handleToss = () => tossMut.mutate(undefined);
            const handleComplete = () => completeMut.mutate();
            const handleUnlink = () =>
              successorMut.mutate({ itemId, planId, successorPlanId: null });

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
                    <dt className="text-muted-foreground">FROM</dt>
                    <dd>
                      {plan.fromMember
                        ? `${plan.fromMember.name} (${plan.fromMember.organizationName || '—'})`
                        : '—'}
                    </dd>
                    <dt className="text-muted-foreground">TO</dt>
                    <dd>
                      {plan.toMember
                        ? `${plan.toMember.name} (${plan.toMember.organizationName || '—'})`
                        : '—'}
                    </dd>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onEdit}
                        aria-label="編集"
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    {plan.status === 'active' && events.length === 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(true)}
                        aria-label="削除"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {plan.ballState === 'ready' && canAct && (
                      <Button onClick={handleToss} disabled={tossMut.isPending}>
                        {tossMut.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Send className="size-4" />
                        )}
                        TOSS する
                      </Button>
                    )}
                    {/* 差し戻し(TOSS取消)は誤TOSS救済のため誰でも実行可 (#50) */}
                    {plan.ballState === 'tossed' && (
                      <Button
                        variant="outline"
                        onClick={() => undoMut.mutate()}
                        disabled={undoMut.isPending}
                      >
                        {undoMut.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Undo2 className="size-4" />
                        )}
                        差し戻す
                      </Button>
                    )}
                    {plan.ballState === 'tossed' && canAct && (
                      <Button onClick={handleComplete} disabled={completeMut.isPending}>
                        {completeMut.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : hasSuccessor ? (
                          <Send className="size-4" />
                        ) : (
                          <CheckCircle2 className="size-4" />
                        )}
                        {hasSuccessor ? '次のタスクへトス' : '完了する'}
                      </Button>
                    )}
                    <Button variant="outline" onClick={onClose}>
                      閉じる
                    </Button>
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
            <AlertDialogDescription>
              この操作は取り消せません。
            </AlertDialogDescription>
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
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function BallHolderBanner({
  plan,
}: {
  plan: { ballHolder: { name: string } | null; ballState: 'ready' | 'tossed' | 'completed'; status: string };
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
        {plan.ballState === 'tossed' ? 'TOSS 済み' : 'TOSS 待ち'}
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
          {e.eventType === 'tossed' ? (
            <Send className="size-3.5 text-sky-600" />
          ) : (
            <CheckCircle2 className="size-3.5 text-emerald-600" />
          )}
          <span className="font-medium">
            {e.eventType === 'tossed' ? 'TOSS' : '完了'}
          </span>
          {e.source === 'auto_chain' && (
            <Badge variant="secondary" className="px-1 py-0 text-[10px]">
              <Zap className="size-3" />
              自動連鎖
            </Badge>
          )}
          <span className="text-muted-foreground">
            by {e.actor?.name ?? 'system'}
          </span>
          <span className="ml-auto text-muted-foreground">
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
