import { useEffect } from 'react';
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

/**
 * SC-17 メンバーかんばん
 *  - 上部の制作物セレクタで対象 item を選び、その plans をメンバー別にかんばん表示
 *  - メンバー列間で DnD すると、ドロップ先メンバーへ TOSS (toMemberId 指定)
 *  - 完了は各カードの「完了する」ボタンで (DnD ではない、シンプル化)
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

  // 制作物未指定なら最初の制作物を自動選択
  useEffect(() => {
    if (!selectedItemId && itemsQuery.data && itemsQuery.data.length > 0) {
      onChangeItem(itemsQuery.data[0]!.id);
    }
  }, [selectedItemId, itemsQuery.data, onChangeItem]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">メンバーかんばん</CardTitle>
          {itemsQuery.data && itemsQuery.data.length > 0 && (
            <div className="w-64">
              <Select
                value={selectedItemId ?? itemsQuery.data[0]?.id ?? ''}
                onValueChange={onChangeItem}
              >
                <SelectTrigger>
                  <SelectValue placeholder="制作物を選択" />
                </SelectTrigger>
                <SelectContent>
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
        {itemsQuery.isLoading || !selectedItemId ? (
          <Skeleton className="h-64 w-full rounded-md" />
        ) : (
          <KanbanBoard
            projectId={projectId}
            itemId={selectedItemId}
            members={members}
          />
        )}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
function KanbanBoard({
  projectId,
  itemId,
  members,
}: {
  projectId: string;
  itemId: string;
  members: ProjectMember[];
}) {
  const qc = useQueryClient();
  const plansQuery = useQuery({
    queryKey: plansQueryKey.list(projectId, itemId),
    queryFn: () => plansApi.list(projectId, itemId),
  });

  const tossMut = useMutation({
    mutationFn: ({ planId, toMemberId }: { planId: string; toMemberId: string }) =>
      plansApi.toss(projectId, itemId, planId, { toMemberId }),
    onMutate: async ({ planId, toMemberId }) => {
      await qc.cancelQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
      const prev = qc.getQueryData<Plan[]>(plansQueryKey.list(projectId, itemId));
      if (prev) {
        const toMember = members.find((m) => m.id === toMemberId);
        qc.setQueryData<Plan[]>(
          plansQueryKey.list(projectId, itemId),
          prev.map((p) =>
            p.id === planId
              ? {
                  ...p,
                  toMember: toMember
                    ? {
                        id: toMember.id,
                        name: toMember.name,
                        organizationName: toMember.organizationName,
                        memberType: toMember.memberType,
                      }
                    : p.toMember,
                  ballHolder: toMember
                    ? {
                        id: toMember.id,
                        name: toMember.name,
                        organizationName: toMember.organizationName,
                        memberType: toMember.memberType,
                      }
                    : p.ballHolder,
                  ballState: 'tossed',
                }
              : p,
          ),
        );
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(plansQueryKey.list(projectId, itemId), ctx.prev);
      }
      toast.error(err instanceof ApiClientError ? err.message : 'TOSS に失敗しました');
    },
    onSuccess: () => toast.success('TOSS しました'),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
    },
  });

  const completeMut = useMutation({
    mutationFn: (planId: string) => plansApi.complete(projectId, itemId, planId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
      toast.success('完了しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '完了に失敗しました'),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const planId = String(e.active.id);
    const overMemberId = e.over?.id ? String(e.over.id) : null;
    if (!overMemberId) return;
    const plan = plansQuery.data?.find((p) => p.id === planId);
    if (!plan) return;
    if (plan.ballHolder?.id === overMemberId) return; // 自列に戻すだけは無視
    tossMut.mutate({ planId, toMemberId: overMemberId });
  };

  if (plansQuery.isLoading) return <Skeleton className="h-64 w-full rounded-md" />;
  if (plansQuery.error)
    return (
      <p className="text-sm text-destructive">予定の取得に失敗しました</p>
    );

  const plans = plansQuery.data ?? [];
  // active な予定のみ表示。完了済みは隠す（完了済みは SC-06 やダッシュボードで参照）
  const plansByHolder = new Map<string, Plan[]>();
  for (const p of plans) {
    if (p.status !== 'active' || !p.ballHolder) continue;
    const arr = plansByHolder.get(p.ballHolder.id) ?? [];
    arr.push(p);
    plansByHolder.set(p.ballHolder.id, arr);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {members.map((m) => (
          <MemberColumn
            key={m.id}
            member={m}
            plans={plansByHolder.get(m.id) ?? []}
            tossing={tossMut.isPending}
            completing={completeMut.isPending}
            onComplete={(planId) => completeMut.mutate(planId)}
          />
        ))}
      </div>
    </DndContext>
  );
}

// -----------------------------------------------------------------------------
function MemberColumn({
  member,
  plans,
  tossing,
  completing,
  onComplete,
}: {
  member: ProjectMember;
  plans: Plan[];
  tossing: boolean;
  completing: boolean;
  onComplete: (planId: string) => void;
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
        <p className="text-[10px] text-muted-foreground">
          {member.organizationName || '—'}
        </p>
        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Badge variant="secondary" className="px-1 py-0 text-[10px]">
            担当 {plans.length} 件
          </Badge>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {plans.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-background p-3 text-center text-[11px] text-muted-foreground">
            ボールはありません
          </div>
        ) : (
          plans.map((p) => (
            <DraggablePlanCard
              key={p.id}
              plan={p}
              completing={completing}
              onComplete={onComplete}
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
  onComplete,
}: {
  plan: Plan;
  completing: boolean;
  onComplete: (planId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: plan.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const cat = CATEGORY_STYLE[plan.category];
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-md border bg-card shadow-sm',
        cat.border,
        isDragging && 'opacity-60',
      )}
    >
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
      >
        <GripVertical className="size-3 opacity-60" />
        <span>{cat.label}</span>
        <Badge variant="secondary" className="ml-auto px-1 py-0 text-[10px]">
          {plan.ballState === 'tossed' ? 'TOSS済' : '準備中'}
        </Badge>
      </div>
      <div className="px-2 py-1.5 text-xs">
        <p className="line-clamp-2 font-medium">{plan.title}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {format(new Date(plan.scheduledDate), 'M/d')}
          {plan.dueDate ? ` 〜 期日 ${format(new Date(plan.dueDate), 'M/d')}` : ''}
        </p>
        <div className="mt-1.5 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-[11px]"
            onClick={() => onComplete(plan.id)}
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
    </div>
  );
}
