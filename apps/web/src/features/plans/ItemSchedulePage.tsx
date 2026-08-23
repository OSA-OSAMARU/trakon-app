import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, differenceInDays, format, parseISO } from 'date-fns';
import { KanbanSquare, Plus, Settings } from 'lucide-react';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { projectsApi, projectsQueryKey } from '@/features/projects/api';
import { membersApi, membersQueryKey } from '@/features/projects/membersApi';
import { plansApi, plansQueryKey, type Plan } from './api';
import { PageHeader } from '@/components/layout/PageHeader';
import { PlanModalsHost } from './PlanModalsHost';
import { DateChangeConfirmModal } from './DateChangeConfirmModal';
import { useReschedulePlan, type ReschedulePatch } from './usePlanReschedule';
import { useSetSuccessor } from './useOptimisticBallAction';
import { planRange, ROW_HEIGHT_DEFAULT } from './scheduleLayout';
import { ScheduleBoard, ZoomControl } from './schedule';

/**
 * SC-06 制作物列スケジュール (/projects/:projectId/items/:itemId)
 * プロトタイプ DeliverableSchedulePage 準拠:
 *  - 縦軸: プロジェクト期間の日付 (連続カレンダー / 行高ズーム可)
 *  - 横軸: 制作物 (deliverable) 列。重なるボールはレーン自動割当
 *  - ボールは scheduledDate〜dueDate のスパンに配置、FROM→TO を可視化
 *  - ドラッグで日付移動 (確認ダイアログ)、上下端ドラッグで期間リサイズ
 */
export function ItemSchedulePage() {
  const { projectId, itemId } = useParams<{ projectId: string; itemId: string }>();
  if (!projectId || !itemId) return <NotFound />;
  return <Inner projectId={projectId} itemId={itemId} />;
}

function Inner({ projectId, itemId }: { projectId: string; itemId: string }) {
  const [params, setParams] = useSearchParams();
  // 予定シート (作成/編集/詳細) が開いている間は、右側パネルに隠れる分だけ
  // スケジュール右端に余白を確保して全列を横スクロールで見えるようにする (#115)
  const planSheetOpen = ['create-plan', 'edit-plan', 'ball-detail'].includes(
    params.get('modal') ?? '',
  );
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT_DEFAULT);
  // 表示する制作物: 'all' か特定 itemId。初期は全制作物 (#49)。
  // 単一に絞る場合は画面内セレクタで選択する。
  const [viewItemId, setViewItemId] = useState<string>('all');

  const projectQuery = useQuery({
    queryKey: projectsQueryKey.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });
  const itemsQuery = useQuery({
    queryKey: projectsQueryKey.items(projectId),
    queryFn: () => projectsApi.listItems(projectId),
  });
  const membersQuery = useQuery({
    queryKey: membersQueryKey.list(projectId),
    queryFn: () => membersApi.list(projectId),
  });
  const plansQuery = useQuery({
    queryKey: plansQueryKey.projectList(projectId),
    queryFn: () => plansApi.listByProject(projectId),
  });

  const qc = useQueryClient();
  const reschedule = useReschedulePlan(projectId);
  const setSuccessor = useSetSuccessor(projectId);
  const [pendingMove, setPendingMove] = useState<{ plan: Plan; dayDelta: number } | null>(null);

  // 予定の複製 (#51)
  const copyMut = useMutation({
    mutationFn: (plan: Plan) => plansApi.copy(projectId, plan.itemId, plan.id),
    onSuccess: (_data, plan) => {
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(projectId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, plan.itemId) });
      toast.success('複製しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '複製に失敗しました'),
  });

  // 別制作物へドラッグ&ドロップで移動 (#52)。日付は drop した行に追従し、
  // successor 紐付けは BE 側で自動解除される。
  const moveItemMut = useMutation({
    mutationFn: ({ plan, targetItemId, dayDelta }: { plan: Plan; targetItemId: string; dayDelta: number }) => {
      const { start, end } = planRange(plan);
      return plansApi.update(projectId, plan.itemId, plan.id, {
        itemId: targetItemId,
        scheduledDate: shiftIso(start, dayDelta),
        dueDate: plan.dueDate ? shiftIso(end, dayDelta) : null,
      });
    },
    onSuccess: (_data, { plan, targetItemId }) => {
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(projectId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, plan.itemId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, targetItemId) });
      toast.success('別の制作物へ移動しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '移動に失敗しました'),
  });

  const project = projectQuery.data;
  const items = useMemo(
    () => (itemsQuery.data ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [itemsQuery.data],
  );
  const members = useMemo(
    () => (membersQuery.data ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [membersQuery.data],
  );
  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);

  const days = useMemo(() => {
    if (!project) return [];
    const start = parseISO(project.startDate);
    const end = parseISO(project.endDate);
    const count = Math.max(0, differenceInDays(end, start) + 1);
    return Array.from({ length: count }, (_, i) => addDays(start, i));
  }, [project]);

  const visibleItems = useMemo(
    () => (viewItemId === 'all' ? items : items.filter((i) => i.id === viewItemId)),
    [items, viewItemId],
  );

  const plansByItem = useMemo(() => {
    const map = new Map<string, Plan[]>();
    for (const p of plans) {
      const arr = map.get(p.itemId) ?? [];
      arr.push(p);
      map.set(p.itemId, arr);
    }
    return map;
  }, [plans]);

  const loading =
    projectQuery.isLoading || itemsQuery.isLoading || membersQuery.isLoading || plansQuery.isLoading;
  const loadFailed = projectQuery.error || itemsQuery.error || membersQuery.error;

  const focusedItem = items.find((i) => i.id === itemId);
  if (loading) return <PageSkeleton />;
  if (!project || !focusedItem || loadFailed) return <NotFound />;

  const openCreateModal = (date: Date, targetItemId: string, dueDate?: Date) => {
    setParams(
      (sp) => {
        sp.set('modal', 'create-plan');
        sp.set('date', format(date, 'yyyy-MM-dd'));
        sp.set('itemId', targetItemId);
        if (dueDate && format(dueDate, 'yyyy-MM-dd') !== format(date, 'yyyy-MM-dd')) {
          sp.set('due', format(dueDate, 'yyyy-MM-dd'));
        } else {
          sp.delete('due');
        }
        sp.delete('planId');
        return sp;
      },
      { replace: true },
    );
  };
  const openDetailModal = (planId: string) => {
    setParams(
      (sp) => {
        sp.set('modal', 'ball-detail');
        sp.set('planId', planId);
        sp.delete('date');
        sp.delete('itemId');
        return sp;
      },
      { replace: true },
    );
  };

  const commitMove = (plan: Plan, dayDelta: number) => {
    if (dayDelta === 0) return;
    setPendingMove({ plan, dayDelta });
  };

  const commitMoveToItem = (plan: Plan, targetItemId: string, dayDelta: number) => {
    if (targetItemId === plan.itemId) return;
    moveItemMut.mutate({ plan, targetItemId, dayDelta });
  };

  const confirmMove = (moveSubsequent: boolean) => {
    if (!pendingMove) return;
    const { plan, dayDelta } = pendingMove;
    const patches: ReschedulePatch[] = [shiftPatch(plan, dayDelta)];
    if (moveSubsequent) {
      // 「次の予定」(successorPlanId) のチェーンをたどって同日数ずらす
      const byId = new Map(plans.map((p) => [p.id, p]));
      const seen = new Set<string>([plan.id]);
      let cur = plan.successorPlanId ? byId.get(plan.successorPlanId) : undefined;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.status === 'active') patches.push(shiftPatch(cur, dayDelta));
        cur = cur.successorPlanId ? byId.get(cur.successorPlanId) : undefined;
      }
    }
    reschedule.mutate(patches);
    setPendingMove(null);
  };

  const commitLink = (source: Plan, target: Plan) => {
    setSuccessor.mutate({
      itemId: source.itemId,
      planId: source.id,
      successorPlanId: target.id,
    });
  };

  const commitResize = (plan: Plan, edge: 'top' | 'bottom', dayDelta: number) => {
    if (dayDelta === 0) return;
    const { start, end } = planRange(plan);
    if (edge === 'top') {
      const newStart = shiftIso(start, dayDelta);
      if (newStart > end) return;
      reschedule.mutate([
        { itemId: plan.itemId, planId: plan.id, patch: { scheduledDate: newStart } },
      ]);
    } else {
      const newEnd = shiftIso(end, dayDelta);
      if (newEnd < start) return;
      reschedule.mutate([
        { itemId: plan.itemId, planId: plan.id, patch: { dueDate: newEnd } },
      ]);
    }
  };

  const headerTargetItem = viewItemId === 'all' ? itemId : viewItemId;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        width="full"
        breadcrumb={
          <>
            <Link to={`/projects/${projectId}/edit`} className="hover:text-foreground">
              {project.name}
            </Link>
            <span>/</span>
            <span>スケジュール</span>
          </>
        }
        title={project.name}
        description={`期間: ${format(parseISO(project.startDate), 'yyyy/M/d')} 〜 ${format(
          parseISO(project.endDate),
          'yyyy/M/d',
        )}`}
        actions={
          <>
            <Select value={viewItemId} onValueChange={setViewItemId}>
              <SelectTrigger className="h-9 w-44 text-xs">
                <SelectValue placeholder="制作物" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全て</SelectItem>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/projects/${projectId}/members`}>
                <KanbanSquare className="size-4" />
                メンバーかんばん
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/projects/${projectId}/edit`}>
                <Settings className="size-4" />
                プロジェクト情報
              </Link>
            </Button>
            <Button size="sm" onClick={() => openCreateModal(new Date(), headerTargetItem)}>
              <Plus className="size-4" />
              予定を追加
            </Button>
          </>
        }
      />

      {members.length === 0 ? (
        <EmptyHint projectId={projectId} />
      ) : days.length === 0 ? (
        <p className="m-8 text-sm text-muted-foreground">プロジェクト期間が設定されていません。</p>
      ) : visibleItems.length === 0 ? (
        <p className="m-8 text-sm text-muted-foreground">制作物がありません。</p>
      ) : (
        <ScheduleBoard
          days={days}
          items={visibleItems}
          plansByItem={plansByItem}
          rowHeight={rowHeight}
          sheetOpen={planSheetOpen}
          editing={{
            onOpenCreate: openCreateModal,
            onOpenDetail: openDetailModal,
            onMove: commitMove,
            onMoveToItem: commitMoveToItem,
            onResize: commitResize,
            onLink: commitLink,
            onCopy: (plan) => copyMut.mutate(plan),
            copyingPlanId: copyMut.isPending ? (copyMut.variables?.id ?? null) : null,
          }}
        />
      )}

      {members.length > 0 && days.length > 0 && (
        <ZoomControl rowHeight={rowHeight} onChange={setRowHeight} />
      )}

      {pendingMove && (
        <DateChangeConfirmModal
          ballName={pendingMove.plan.title}
          onClose={() => setPendingMove(null)}
          onConfirm={confirmMove}
        />
      )}

      <PlanModalsHost projectId={projectId} members={members} plans={plans} items={items} fallbackItemId={itemId} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// helpers / misc
// -----------------------------------------------------------------------------

function shiftIso(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), 'yyyy-MM-dd');
}

function shiftPatch(plan: Plan, dayDelta: number): ReschedulePatch {
  const { start, end } = planRange(plan);
  return {
    itemId: plan.itemId,
    planId: plan.id,
    patch: {
      scheduledDate: shiftIso(start, dayDelta),
      dueDate: plan.dueDate ? shiftIso(end, dayDelta) : null,
    },
  };
}

function EmptyHint({ projectId }: { projectId: string }) {
  return (
    <div className="m-8 rounded-md border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
      まずは参加者を追加してください。
      <div className="mt-3">
        <Button size="sm" variant="outline" asChild>
          <Link to={`/projects/${projectId}/members?tab=manage`}>参加者管理を開く</Link>
        </Button>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-3 p-8">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-[60vh] w-full rounded-md" />
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-20 text-center text-sm text-muted-foreground">
      ページが見つかりませんでした。
      <div className="mt-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/projects">プロジェクト一覧へ</Link>
        </Button>
      </div>
    </div>
  );
}
