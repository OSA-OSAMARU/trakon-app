import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CheckCircle2, GripVertical, Loader2 } from 'lucide-react';
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
import { projectsApi, projectsQueryKey } from '@/features/projects/api';
import type { ProjectMember } from '@/features/projects/membersApi';
import { plansApi, plansQueryKey, type Plan } from './api';
import { CATEGORY_STYLE } from './categoryColor';
import { PlanModalsHost } from './PlanModalsHost';

const ALL = '__all__';

/**
 * SC-17 メンバーかんばん (プロトタイプ MemberKanbanPage 準拠)
 *  - 制作チーム / クライアント のスイムレーンに分割
 *  - 制作物セレクタ (すべて / 個別) で対象を絞り込み (既定: すべて)
 *  - メンバー列間で DnD すると、ドロップ先メンバーへ TOSS
 *  - カードクリックでボール詳細モーダル / 各カードに「完了する」
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
          <CardTitle className="text-base">メンバーかんばん</CardTitle>
          {itemsQuery.data && itemsQuery.data.length > 0 && (
            <div className="w-64">
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
        <KanbanBoard
          projectId={projectId}
          itemFilter={itemFilter === ALL ? null : itemFilter}
          members={members}
          itemNameById={
            new Map((itemsQuery.data ?? []).map((it) => [it.id, it.name]))
          }
        />
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
function KanbanBoard({
  projectId,
  itemFilter,
  members,
  itemNameById,
}: {
  projectId: string;
  itemFilter: string | null;
  members: ProjectMember[];
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

  const tossMut = useMutation({
    mutationFn: ({ plan, toMemberId }: { plan: Plan; toMemberId: string }) =>
      plansApi.toss(projectId, plan.itemId, plan.id, { toMemberId }),
    onMutate: async ({ plan, toMemberId }) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<Plan[]>(listKey);
      if (prev) {
        const toMember = members.find((m) => m.id === toMemberId);
        const ref = toMember
          ? {
              id: toMember.id,
              name: toMember.name,
              organizationName: toMember.organizationName,
              memberType: toMember.memberType,
            }
          : null;
        qc.setQueryData<Plan[]>(
          listKey,
          prev.map((p) =>
            p.id === plan.id && ref
              ? { ...p, toMember: ref, ballHolder: ref, ballState: 'tossed' }
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
    onSettled: (_d, _e, vars) => invalidateAll(vars.plan.itemId),
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

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

  const production = members.filter((m) => m.memberType === 'production');
  const clients = members.filter((m) => m.memberType === 'client');

  const onDragEnd = (e: DragEndEvent) => {
    const planId = String(e.active.id);
    const overMemberId = e.over?.id ? String(e.over.id) : null;
    if (!overMemberId) return;
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    if (plan.ballHolder?.id === overMemberId) return; // 同じ列なら無視
    tossMut.mutate({ plan, toMemberId: overMemberId });
  };

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
              tossing={tossMut.isPending}
              completing={completeMut.isPending}
              itemNameById={itemNameById}
              onComplete={(plan) => completeMut.mutate(plan)}
              onOpenDetail={openDetail}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="space-y-5">
        {renderLane('制作チーム', production)}
        {renderLane('クライアント', clients)}
      </div>
      <PlanModalsHost
        projectId={projectId}
        members={members}
        plans={plansQuery.data ?? []}
        fallbackItemId={itemFilter ?? (plansQuery.data?.[0]?.itemId ?? '')}
      />
    </DndContext>
  );
}

// -----------------------------------------------------------------------------
function MemberColumn({
  member,
  plans,
  tossing,
  completing,
  itemNameById,
  onComplete,
  onOpenDetail,
}: {
  member: ProjectMember;
  plans: Plan[];
  tossing: boolean;
  completing: boolean;
  itemNameById: Map<string, string>;
  onComplete: (plan: Plan) => void;
  onOpenDetail: (planId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: member.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-w-[260px] max-w-[280px] flex-col rounded-md border border-border bg-muted/30 p-2 transition-colors',
        isOver && 'border-primary/60 bg-primary/5',
        tossing && 'opacity-95',
      )}
    >
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
            <DraggablePlanCard
              key={p.id}
              plan={p}
              completing={completing}
              itemName={itemNameById.get(p.itemId)}
              onComplete={onComplete}
              onOpenDetail={onOpenDetail}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggablePlanCard({
  plan,
  completing,
  itemName,
  onComplete,
  onOpenDetail,
}: {
  plan: Plan;
  completing: boolean;
  itemName?: string;
  onComplete: (plan: Plan) => void;
  onOpenDetail: (planId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: plan.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const cat = CATEGORY_STYLE[plan.category];
  const overdue =
    plan.ballState === 'ready' &&
    !!plan.dueDate &&
    new Date(plan.dueDate) < new Date(new Date().toDateString());

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-md border bg-card shadow-sm',
        overdue ? 'border-red-400' : cat.border,
        isDragging && 'opacity-60',
      )}
    >
      {/* ドラッグハンドル (ヘッダー) */}
      <div
        className={cn(
          'flex items-center gap-1 rounded-t-md px-2 py-1 text-[10px]',
          cat.bg,
          cat.text,
        )}
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        aria-label="ドラッグして TOSS"
      >
        <GripVertical className="size-3 opacity-60" />
        <span>{cat.label}</span>
        <Badge variant="secondary" className="ml-auto px-1 py-0 text-[10px]">
          {plan.ballState === 'tossed' ? 'TOSS済' : '準備中'}
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
        {plan.toMember && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">Next: {plan.toMember.name}</p>
        )}
      </button>
      <div className="flex justify-end px-2 pb-1.5">
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
          完了する
        </Button>
      </div>
    </div>
  );
}
