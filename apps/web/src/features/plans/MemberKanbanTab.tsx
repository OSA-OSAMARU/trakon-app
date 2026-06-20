import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/components/ui/utils';
import { ApiClientError } from '@/lib/api';
import { projectsApi, projectsQueryKey, type ProjectItem } from '@/features/projects/api';
import type { ProjectMember } from '@/features/projects/membersApi';
import { plansApi, plansQueryKey, type Plan } from './api';
import { CATEGORY_STYLE } from './categoryColor';
import { PlanModalsHost } from './PlanModalsHost';

const ALL = '__all__';

/**
 * SC-17 担当者ボード (旧 メンバーかんばん)
 *  - 制作チーム / クライアント のスイムレーンに分割
 *  - 制作物セレクタ (すべて / 個別) で対象を絞り込み (既定: すべて)
 *  - ボール保持者ごとに担当中の予定を一覧表示
 *  - TOSS は「次の担当者へ」明示ボタンでワンクリック (予め決まった toMember へ前進)
 *  - 誤操作の救済として tossed カードに「差し戻す」(undoToss) を用意
 */
export function MemberKanbanTab({
  projectId,
  members,
  selectedItemId,
  onChangeItem,
}: {
  projectId: string;
  members: ProjectMember[];
  selectedItemId: string | null;
  onChangeItem: (itemId: string) => void;
}) {
  const itemsQuery = useQuery({
    queryKey: projectsQueryKey.items(projectId),
    queryFn: () => projectsApi.listItems(projectId),
  });

  const itemFilter = selectedItemId ?? ALL;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">担当者ボード</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ボール保持者ごとに担当中の予定を表示。トスは次の担当者へのボタンで行います。
            </p>
          </div>
          {itemsQuery.data && itemsQuery.data.length > 0 && (
            <div className="w-64 shrink-0">
              <Select value={itemFilter} onValueChange={onChangeItem}>
                <SelectTrigger>
                  <SelectValue placeholder="制作物を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>すべての制作物</SelectItem>
                  {itemsQuery.data.map((it) => (
                    <SelectItem key={it.id} value={it.id}>
                      {it.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <MemberBoard
          projectId={projectId}
          itemFilter={itemFilter === ALL ? null : itemFilter}
          members={members}
          items={itemsQuery.data ?? []}
          itemNameById={
            new Map((itemsQuery.data ?? []).map((it) => [it.id, it.name]))
          }
        />
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
function MemberBoard({
  projectId,
  itemFilter,
  members,
  items,
  itemNameById,
}: {
  projectId: string;
  itemFilter: string | null;
  members: ProjectMember[];
  items: ProjectItem[];
  itemNameById: Map<string, string>;
}) {
  const qc = useQueryClient();
  const [, setParams] = useSearchParams();
  const listKey = plansQueryKey.projectList(projectId);

  const plansQuery = useQuery({
    queryKey: listKey,
    queryFn: () => plansApi.listByProject(projectId),
  });

  const invalidateAll = (itemId: string) => {
    qc.invalidateQueries({ queryKey: listKey });
    qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
  };

  /** plan.toMember を新ホルダーとして楽観更新 (toMember 既定先へ前進)。 */
  const tossMut = useMutation({
    mutationFn: (plan: Plan) => plansApi.toss(projectId, plan.itemId, plan.id),
    onMutate: async (plan) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<Plan[]>(listKey);
      if (prev) {
        qc.setQueryData<Plan[]>(
          listKey,
          prev.map((p) =>
            p.id === plan.id
              ? { ...p, ballHolder: p.toMember, ballState: 'tossed' }
              : p,
          ),
        );
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
      toast.error(err instanceof ApiClientError ? err.message : 'TOSS に失敗しました');
    },
    onSuccess: () => toast.success('TOSS しました'),
    onSettled: (_d, _e, plan) => invalidateAll(plan.itemId),
  });

  /** tossed の差し戻し: fromMember を再びホルダーに戻す楽観更新。 */
  const undoMut = useMutation({
    mutationFn: (plan: Plan) => plansApi.undoToss(projectId, plan.itemId, plan.id),
    onMutate: async (plan) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<Plan[]>(listKey);
      if (prev) {
        qc.setQueryData<Plan[]>(
          listKey,
          prev.map((p) =>
            p.id === plan.id
              ? { ...p, ballHolder: p.fromMember, ballState: 'ready' }
              : p,
          ),
        );
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
      toast.error(err instanceof ApiClientError ? err.message : '差し戻しに失敗しました');
    },
    onSuccess: () => toast.success('差し戻しました'),
    onSettled: (_d, _e, plan) => invalidateAll(plan.itemId),
  });

  const completeMut = useMutation({
    mutationFn: (plan: Plan) => plansApi.complete(projectId, plan.itemId, plan.id),
    onSuccess: (_d, plan) => {
      invalidateAll(plan.itemId);
      toast.success('完了しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '完了に失敗しました'),
  });

  const plans = useMemo(() => {
    const all = plansQuery.data ?? [];
    return itemFilter ? all.filter((p) => p.itemId === itemFilter) : all;
  }, [plansQuery.data, itemFilter]);

  const plansByHolder = useMemo(() => {
    const map = new Map<string, Plan[]>();
    for (const p of plans) {
      if (p.status !== 'active' || !p.ballHolder) continue;
      const arr = map.get(p.ballHolder.id) ?? [];
      arr.push(p);
      map.set(p.ballHolder.id, arr);
    }
    return map;
  }, [plans]);

  /**
   * 完了済み予定を「完了者 (= ballHolder, 完了時の to_member)」ごとに集約 (#63)。
   * 各メンバー列の下部に履歴として表示する。完了日時の新しい順に並べる。
   */
  const completedByHolder = useMemo(() => {
    const map = new Map<string, Plan[]>();
    for (const p of plans) {
      if (p.status !== 'completed' || !p.ballHolder) continue;
      const arr = map.get(p.ballHolder.id) ?? [];
      arr.push(p);
      map.set(p.ballHolder.id, arr);
    }
    for (const arr of map.values()) {
      arr.sort(
        (a, b) =>
          new Date(b.completedAt ?? b.updatedAt).getTime() -
          new Date(a.completedAt ?? a.updatedAt).getTime(),
      );
    }
    return map;
  }, [plans]);

  const production = members.filter((m) => m.memberType === 'production');
  const clients = members.filter((m) => m.memberType === 'client');

  const openDetail = (planId: string) =>
    setParams(
      (sp) => {
        sp.set('modal', 'ball-detail');
        sp.set('planId', planId);
        return sp;
      },
      { replace: true },
    );

  if (plansQuery.isLoading) return <Skeleton className="h-64 w-full rounded-md" />;
  if (plansQuery.error)
    return <p className="text-sm text-destructive">予定の取得に失敗しました</p>;

  const renderLane = (title: string, laneMembers: ProjectMember[]) => {
    if (laneMembers.length === 0) return null;
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {laneMembers.map((m) => (
            <MemberColumn
              key={m.id}
              member={m}
              plans={plansByHolder.get(m.id) ?? []}
              completedPlans={completedByHolder.get(m.id) ?? []}
              tossing={tossMut.isPending}
              undoing={undoMut.isPending}
              completing={completeMut.isPending}
              itemNameById={itemNameById}
              onToss={(plan) => tossMut.mutate(plan)}
              onUndo={(plan) => undoMut.mutate(plan)}
              onComplete={(plan) => completeMut.mutate(plan)}
              onOpenDetail={openDetail}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-5">
        {renderLane('制作チーム', production)}
        {renderLane('クライアント', clients)}
      </div>
      <PlanModalsHost
        projectId={projectId}
        members={members}
        plans={plansQuery.data ?? []}
        items={items}
        fallbackItemId={itemFilter ?? (plansQuery.data?.[0]?.itemId ?? '')}
      />
    </>
  );
}

// -----------------------------------------------------------------------------
function MemberColumn({
  member,
  plans,
  completedPlans,
  tossing,
  undoing,
  completing,
  itemNameById,
  onToss,
  onUndo,
  onComplete,
  onOpenDetail,
}: {
  member: ProjectMember;
  plans: Plan[];
  completedPlans: Plan[];
  tossing: boolean;
  undoing: boolean;
  completing: boolean;
  itemNameById: Map<string, string>;
  onToss: (plan: Plan) => void;
  onUndo: (plan: Plan) => void;
  onComplete: (plan: Plan) => void;
  onOpenDetail: (planId: string) => void;
}) {
  return (
    <div className="flex min-w-[260px] max-w-[280px] flex-col rounded-md border border-border bg-muted/30 p-2">
      <div className="mb-2 sticky top-0 z-10 rounded-md bg-card px-2 py-1.5">
        <p className="text-sm font-medium leading-tight">{member.name}</p>
        <p className="text-[10px] text-muted-foreground">{member.organizationName || '—'}</p>
        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Badge variant="secondary" className="px-1 py-0 text-[10px]">
            担当 {plans.length} 件
          </Badge>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {plans.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-background p-3 text-center text-[11px] text-muted-foreground">
            担当中の予定はありません
          </div>
        ) : (
          plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              tossing={tossing}
              undoing={undoing}
              completing={completing}
              itemName={itemNameById.get(p.itemId)}
              onToss={onToss}
              onUndo={onUndo}
              onComplete={onComplete}
              onOpenDetail={onOpenDetail}
            />
          ))
        )}
      </div>
      {completedPlans.length > 0 && (
        <CompletedHistory
          plans={completedPlans}
          itemNameById={itemNameById}
          onOpenDetail={onOpenDetail}
        />
      )}
    </div>
  );
}

/**
 * 完了済み予定の履歴セクション (#63)。
 * メンバー列の下部に折りたたみ式で表示し、既定は閉じた状態。
 */
function CompletedHistory({
  plans,
  itemNameById,
  onOpenDetail,
}: {
  plans: Plan[];
  itemNameById: Map<string, string>;
  onOpenDetail: (planId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-1 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent/30"
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        履歴 {plans.length} 件
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {plans.map((p) => (
            <CompletedPlanCard
              key={p.id}
              plan={p}
              itemName={itemNameById.get(p.itemId)}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 完了済み予定の読み取り専用カード (アクションなし、クリックで詳細)。 */
function CompletedPlanCard({
  plan,
  itemName,
  onOpenDetail,
}: {
  plan: Plan;
  itemName?: string;
  onOpenDetail: (planId: string) => void;
}) {
  const cat = CATEGORY_STYLE[plan.category];
  const completedOn = plan.completedAt ?? plan.updatedAt;
  return (
    <div className="rounded-md border border-slate-200 bg-muted/40 opacity-80">
      <div className="flex items-center gap-1 rounded-t-md bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
        <span>{cat.label}</span>
        <Badge
          variant="secondary"
          className="ml-auto gap-0.5 px-1 py-0 text-[10px] text-slate-600"
        >
          <CheckCircle2 className="size-2.5" />
          完了
        </Badge>
      </div>
      <button
        type="button"
        onClick={() => onOpenDetail(plan.id)}
        className="block w-full px-2 py-1.5 text-left text-xs hover:bg-accent/30"
      >
        <p className="line-clamp-2 font-medium text-slate-600">{plan.title}</p>
        {itemName && (
          <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{itemName}</p>
        )}
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          完了 {format(new Date(completedOn), 'M/d')}
        </p>
        {(plan.fromMember || plan.toMember) && (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="truncate">{plan.fromMember?.name ?? '—'}</span>
            <ArrowRight className="size-2.5 shrink-0 opacity-60" />
            <span className="truncate">{plan.toMember?.name ?? '—'}</span>
          </p>
        )}
      </button>
    </div>
  );
}

function PlanCard({
  plan,
  tossing,
  undoing,
  completing,
  itemName,
  onToss,
  onUndo,
  onComplete,
  onOpenDetail,
}: {
  plan: Plan;
  tossing: boolean;
  undoing: boolean;
  completing: boolean;
  itemName?: string;
  onToss: (plan: Plan) => void;
  onUndo: (plan: Plan) => void;
  onComplete: (plan: Plan) => void;
  onOpenDetail: (planId: string) => void;
}) {
  const cat = CATEGORY_STYLE[plan.category];
  const tossed = plan.ballState === 'tossed';
  const ready = plan.ballState === 'ready';
  const overdue =
    ready &&
    !!plan.dueDate &&
    new Date(plan.dueDate) < new Date(new Date().toDateString());

  return (
    <div
      className={cn(
        'rounded-md border bg-card shadow-sm',
        overdue ? 'border-red-400' : tossed ? 'border-slate-300' : cat.border,
      )}
    >
      {/* カテゴリ + 状態 */}
      <div
        className={cn(
          'flex items-center gap-1 rounded-t-md px-2 py-1 text-[10px]',
          tossed ? 'bg-slate-100 text-slate-600' : cn(cat.bg, cat.text),
        )}
      >
        <span>{cat.label}</span>
        <Badge variant="secondary" className="ml-auto px-1 py-0 text-[10px]">
          {tossed ? 'TOSS済' : '準備中'}
        </Badge>
      </div>
      {/* 本体 (クリックで詳細) */}
      <button
        type="button"
        onClick={() => onOpenDetail(plan.id)}
        className="block w-full px-2 py-1.5 text-left text-xs hover:bg-accent/30"
      >
        <p className={cn('line-clamp-2 font-medium', overdue && 'text-red-700')}>
          {plan.title}
        </p>
        {itemName && (
          <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{itemName}</p>
        )}
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {format(new Date(plan.scheduledDate), 'M/d')}
          {plan.dueDate ? ` 〜 期日 ${format(new Date(plan.dueDate), 'M/d')}` : ''}
        </p>
        {/* FROM → TO の流れ */}
        {(plan.fromMember || plan.toMember) && (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="truncate">{plan.fromMember?.name ?? '—'}</span>
            <ArrowRight className="size-2.5 shrink-0 opacity-60" />
            <span className="truncate">{plan.toMember?.name ?? '—'}</span>
          </p>
        )}
      </button>
      {/* アクション (状態で出し分け) */}
      <div className="flex flex-wrap items-center justify-end gap-1 px-2 pb-1.5">
        {ready && plan.toMember && (
          <Button
            size="sm"
            className="h-7 gap-1 text-[11px]"
            onClick={() => onToss(plan)}
            disabled={tossing}
          >
            {tossing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ArrowRight className="size-3" />
            )}
            {plan.toMember.name}へトス
          </Button>
        )}
        {tossed && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-[11px]"
            onClick={() => onUndo(plan)}
            disabled={undoing}
          >
            {undoing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Undo2 className="size-3" />
            )}
            差し戻す
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-[11px]"
          onClick={() => onComplete(plan)}
          disabled={completing}
        >
          {completing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <CheckCircle2 className="size-3" />
          )}
          完了
        </Button>
      </div>
    </div>
  );
}
