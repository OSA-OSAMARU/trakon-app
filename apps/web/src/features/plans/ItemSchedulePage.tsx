import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, differenceInDays, format, isSameDay, isWeekend, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { isHoliday } from '@holiday-jp/holiday_jp';
import { CheckCircle2, Copy, KanbanSquare, Loader2, Plus, Settings, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/components/ui/utils';
import { projectsApi, projectsQueryKey, type ProjectItem } from '@/features/projects/api';
import { membersApi, membersQueryKey } from '@/features/projects/membersApi';
import { deriveLineBallHolders } from '@trakon/shared';
import { plansApi, plansQueryKey, type Plan, type MemberRef } from './api';
import { CATEGORY_STYLE } from './planTheme';
import { PageHeader } from '@/components/layout/PageHeader';
import { PlanModalsHost } from './PlanModalsHost';
import { DateChangeConfirmModal } from './DateChangeConfirmModal';
import { useReschedulePlan, type ReschedulePatch } from './usePlanReschedule';
import { useSetSuccessor } from './useOptimisticBallAction';
import {
  assignLanes,
  ballTier,
  chipVerticalBounds,
  dayIndex,
  isActiveNow,
  isOverdue,
  itemColor,
  planRange,
  ROW_HEIGHT_DEFAULT,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_STEP,
  scaledLaneWidth,
  scaledMinColumnWidth,
} from './scheduleLayout';

const DATE_AXIS_WIDTH = 76;

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
          onOpenCreate={openCreateModal}
          onOpenDetail={openDetailModal}
          onMove={commitMove}
          onMoveToItem={commitMoveToItem}
          onResize={commitResize}
          onLink={commitLink}
          onCopy={(plan) => copyMut.mutate(plan)}
          copyingPlanId={copyMut.isPending ? copyMut.variables?.id ?? null : null}
          sheetOpen={planSheetOpen}
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
// Board
// -----------------------------------------------------------------------------

type DragState = {
  plan: Plan;
  mode: 'move' | 'resize-top' | 'resize-bottom';
  startClientY: number;
  dayDelta: number;
  moved: boolean;
  // move 中にポインタが乗っている制作物列。別制作物なら drop で移動 (#52)。
  targetItemId: string | null;
};

// 後続紐づけドラッグ (カード下部コネクタ → 別カード)。座標はビューポート基準 (client)。
type LinkDrag = {
  source: Plan;
  start: { x: number; y: number };
  pointer: { x: number; y: number };
  targetId: string | null;
};

/**
 * source の後続として target を設定できるか (BE assertSuccessorAvailable のミラー)。
 * 同一制作物・自己参照禁止・active・他から後続参照されていない・直接循環なし。
 */
function isValidLinkTarget(source: Plan, target: Plan, itemPlans: Plan[]): boolean {
  if (target.id === source.id) return false;
  if (target.itemId !== source.itemId) return false;
  if (target.status !== 'active') return false;
  if (itemPlans.some((p) => p.id !== source.id && p.successorPlanId === target.id)) return false;
  // target のチェーンが source へ戻る場合は循環になるので不可
  const byId = new Map(itemPlans.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let cur: Plan | undefined = target;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.id === source.id) return false;
    cur = cur.successorPlanId ? byId.get(cur.successorPlanId) : undefined;
  }
  return true;
}

/**
 * planId が属する後続チェーン (前後双方向にたどった全 plan) と、
 * その内部リンク (チェーン内の先行→後続) の source id 集合を返す。
 * ホバー時のチェーン強調に使う。
 */
function computeChain(
  itemPlans: Plan[],
  planId: string,
): { chainIds: Set<string>; linkSourceIds: Set<string> } {
  const byId = new Map(itemPlans.map((p) => [p.id, p]));
  const predOf = new Map<string, string>(); // successorId -> predecessorId
  for (const p of itemPlans) {
    if (p.successorPlanId) predOf.set(p.successorPlanId, p.id);
  }
  const chainIds = new Set<string>();
  // 後続方向
  let cur: Plan | undefined = byId.get(planId);
  while (cur && !chainIds.has(cur.id)) {
    chainIds.add(cur.id);
    cur = cur.successorPlanId ? byId.get(cur.successorPlanId) : undefined;
  }
  // 先行方向
  let prevId = predOf.get(planId);
  while (prevId && !chainIds.has(prevId)) {
    chainIds.add(prevId);
    prevId = predOf.get(prevId);
  }
  // チェーン内リンク (両端がチェーンに含まれる先行 plan)
  const linkSourceIds = new Set<string>();
  for (const id of chainIds) {
    const succ = byId.get(id)?.successorPlanId;
    if (succ && chainIds.has(succ)) linkSourceIds.add(id);
  }
  return { chainIds, linkSourceIds };
}

/**
 * ライン単位の現在のボール保持者 (member) を解決する (#117)。
 * deriveLineBallHolders が返す member_id を、予定に紐づく MemberRef へ解決する。
 */
function resolveHolders(itemPlans: Plan[]): MemberRef[] {
  const holderIds = deriveLineBallHolders(
    itemPlans.map((p) => ({
      id: p.id,
      successorPlanId: p.successorPlanId,
      status: p.status,
      ballState: p.ballState,
      executorMemberId: p.executor?.id ?? null,
      approverMemberId: p.approver?.id ?? null,
      progressManagerMemberId: p.progressManager?.id ?? null,
      toMemberId: p.toMember?.id ?? null,
    })),
  );
  const refById = new Map<string, MemberRef>();
  for (const p of itemPlans) {
    for (const m of [p.executor, p.approver, p.progressManager, p.fromMember, p.toMember]) {
      if (m) refById.set(m.id, m);
    }
  }
  return holderIds
    .map((id) => refById.get(id))
    .filter((m): m is MemberRef => m !== undefined);
}

function ScheduleBoard({
  days,
  items,
  plansByItem,
  rowHeight,
  onOpenCreate,
  onOpenDetail,
  onMove,
  onMoveToItem,
  onResize,
  onLink,
  onCopy,
  copyingPlanId,
  sheetOpen,
}: {
  days: Date[];
  items: ProjectItem[];
  plansByItem: Map<string, Plan[]>;
  rowHeight: number;
  onOpenCreate: (date: Date, itemId: string, dueDate?: Date) => void;
  onOpenDetail: (planId: string) => void;
  onMove: (plan: Plan, dayDelta: number) => void;
  onMoveToItem: (plan: Plan, targetItemId: string, dayDelta: number) => void;
  onResize: (plan: Plan, edge: 'top' | 'bottom', dayDelta: number) => void;
  onLink: (source: Plan, target: Plan) => void;
  onCopy: (plan: Plan) => void;
  copyingPlanId: string | null;
  sheetOpen: boolean;
}) {
  const today = new Date();
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  // 後続紐づけドラッグ
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const linkRef = useRef<LinkDrag | null>(null);
  linkRef.current = linkDrag;

  // ホバー中の予定 (チェーン強調用)。ドラッグ中は抑制する。
  const [hoveredPlanId, setHoveredPlanId] = useState<string | null>(null);

  const startLink = (e: React.PointerEvent, plan: Plan) => {
    e.stopPropagation();
    e.preventDefault();
    setLinkDrag({
      source: plan,
      start: { x: e.clientX, y: e.clientY },
      pointer: { x: e.clientX, y: e.clientY },
      targetId: null,
    });
  };

  useEffect(() => {
    if (!linkDrag) return;
    const onMovePointer = (e: PointerEvent) => {
      const ld = linkRef.current;
      if (!ld) return;
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const chip = el?.closest('[data-plan-id]') as HTMLElement | null;
      const overId = chip?.getAttribute('data-plan-id') ?? null;
      const itemPlans = plansByItem.get(ld.source.itemId) ?? [];
      let targetId: string | null = null;
      if (overId && overId !== ld.source.id) {
        const target = itemPlans.find((p) => p.id === overId);
        if (target && isValidLinkTarget(ld.source, target, itemPlans)) targetId = overId;
      }
      setLinkDrag({ ...ld, pointer: { x: e.clientX, y: e.clientY }, targetId });
    };
    const onUpPointer = () => {
      const ld = linkRef.current;
      setLinkDrag(null);
      if (ld && ld.targetId) {
        const itemPlans = plansByItem.get(ld.source.itemId) ?? [];
        const target = itemPlans.find((p) => p.id === ld.targetId);
        if (target) onLink(ld.source, target);
      }
    };
    window.addEventListener('pointermove', onMovePointer);
    window.addEventListener('pointerup', onUpPointer);
    return () => {
      window.removeEventListener('pointermove', onMovePointer);
      window.removeEventListener('pointerup', onUpPointer);
    };
  }, [linkDrag, plansByItem, onLink]);

  // 空セルの縦ドラッグで期間付き新規作成
  type CreateDrag = { itemId: string; startIdx: number; endIdx: number };
  const [createDrag, setCreateDrag] = useState<CreateDrag | null>(null);
  const createDragRef = useRef<CreateDrag | null>(null);
  createDragRef.current = createDrag;

  // ドラッグ系の操作中はホバー強調を抑制する。
  const interacting = drag !== null || linkDrag !== null || createDrag !== null;
  const activeHoverId = interacting ? null : hoveredPlanId;

  useEffect(() => {
    if (!createDrag) return;
    const onUp = () => {
      const cd = createDragRef.current;
      setCreateDrag(null);
      if (!cd) return;
      const s = Math.min(cd.startIdx, cd.endIdx);
      const e = Math.max(cd.startIdx, cd.endIdx);
      const startDate = days[s];
      const endDate = days[e];
      if (!startDate) return;
      if (s === e) onOpenCreate(startDate, cd.itemId);
      else onOpenCreate(startDate, cd.itemId, endDate);
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [createDrag, days, onOpenCreate]);

  useEffect(() => {
    if (!drag) return;
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaPx = e.clientY - d.startClientY;
      const dayDelta = Math.round(deltaPx / rowHeight);
      const moved = Math.abs(deltaPx) > 4;
      // move 中はポインタ下の制作物列を判定し、別制作物なら移動ターゲットにする (#52)
      let targetItemId = d.targetItemId;
      if (d.mode === 'move') {
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const col = el?.closest('[data-item-id]') as HTMLElement | null;
        targetItemId = col?.getAttribute('data-item-id') ?? null;
      }
      if (dayDelta !== d.dayDelta || moved !== d.moved || targetItemId !== d.targetItemId) {
        setDrag({ ...d, dayDelta, moved, targetItemId });
      }
    };
    const onPointerUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.mode === 'move') {
        if (!d.moved) onOpenDetail(d.plan.id);
        else if (d.targetItemId && d.targetItemId !== d.plan.itemId)
          onMoveToItem(d.plan, d.targetItemId, d.dayDelta);
        else onMove(d.plan, d.dayDelta);
      } else {
        onResize(d.plan, d.mode === 'resize-top' ? 'top' : 'bottom', d.dayDelta);
      }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [drag, rowHeight, onMove, onMoveToItem, onResize, onOpenDetail]);

  const totalHeight = days.length * rowHeight;
  // 横方向も rowHeight に連動させ、拡大バーで縦横を同倍率ズームする (#71)
  const laneWidth = scaledLaneWidth(rowHeight);
  const minColumnWidth = scaledMinColumnWidth(rowHeight);

  const dayTones = useMemo(
    () =>
      days.map((d) => {
        const weekend = isWeekend(d);
        const holiday = isHoliday(d);
        const today2 = isSameDay(d, today);
        const tone = today2
          ? 'bg-amber-50'
          : holiday
            ? 'bg-rose-50/60'
            : weekend
              ? 'bg-slate-50'
              : 'bg-background';
        return { weekend, holiday, today: today2, tone, first: d.getDate() === 1 };
      }),
    // today はマウント時点で固定で良い
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, rowHeight],
  );

  return (
    <>
    <div className="flex-1 overflow-auto">
      <div className={cn('flex w-max select-none', sheetOpen && 'pr-[440px]')}>
        {/* 日付軸 (sticky left) */}
        <div
          className="sticky left-0 z-30 shrink-0 border-r border-border bg-background"
          style={{ width: DATE_AXIS_WIDTH }}
        >
          <div className="sticky top-0 z-10 h-16 border-b border-border bg-background" />
          <div className="relative" style={{ height: totalHeight }}>
            {days.map((d, i) => {
              const t = dayTones[i]!;
              return (
                <div
                  key={i}
                  className={cn(
                    'absolute left-0 right-0 flex flex-col items-center justify-center border-b border-border text-xs',
                    t.tone,
                    t.first && 'border-t-2 border-t-foreground/20',
                    t.today && 'font-semibold text-amber-700',
                    t.holiday && 'text-rose-600',
                  )}
                  style={{ top: i * rowHeight, height: rowHeight }}
                >
                  <span>{format(d, 'M/d')}</span>
                  {rowHeight >= 30 && (
                    <span
                      className={cn(
                        'text-[10px]',
                        t.weekend ? 'text-slate-500' : 'text-muted-foreground',
                        t.holiday && 'text-rose-500',
                      )}
                    >
                      {format(d, 'EEEEE', { locale: ja })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 制作物列 */}
        {items.map((item) => {
          const itemPlans = (plansByItem.get(item.id) ?? [])
            .slice()
            .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
          const { laneOf, laneCount } = assignLanes(itemPlans);
          const colWidth = Math.max(minColumnWidth, laneCount * laneWidth);
          const color = itemColor(item.id);
          // 代表ボール保持者 = ライン (後続チェーン) 単位で現在の保持者を導出 (#117)。
          // 後続で繋がっていない予定は別ライン扱いなので、保持者が複数になりうる。
          const repHolders = resolveHolders(itemPlans);
          // コネクト印用: 先行 (誰かの後続として指されている) plan の id 集合
          const predecessorTargetIds = new Set(
            itemPlans
              .map((p) => p.successorPlanId)
              .filter((id): id is string => id !== null),
          );
          // ホバー中の予定がこの列に属するならチェーンを算出
          const chain =
            activeHoverId && itemPlans.some((p) => p.id === activeHoverId)
              ? computeChain(itemPlans, activeHoverId)
              : null;
          return (
            <div
              key={item.id}
              className="shrink-0 border-r border-border"
              style={{ width: colWidth }}
            >
              {/* 列ヘッダー (sticky top): 制作物名 ＋ 現在のボール保持者 */}
              <div className="sticky top-0 z-20 flex h-16 flex-col justify-center gap-0.5 border-b border-border bg-background px-3">
                <div className="flex items-center gap-2">
                  <span className={cn('size-2.5 shrink-0 rounded-full', color.dot)} />
                  <span className="truncate text-sm font-medium">{item.name}</span>
                  <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
                    {itemPlans.length}件
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="shrink-0">ボール保持:</span>
                  {repHolders.length > 0 ? (
                    <span className="truncate font-medium text-foreground">
                      {repHolders
                        .map((h) => (h.organizationName ? `${h.organizationName} ${h.name}` : h.name))
                        .join('、')}
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                </div>
              </div>

              {/* 本体 */}
              <div
                data-item-id={item.id}
                className={cn(
                  // isolate で本体を独立した stacking context にし、内部の後続矢印 (SVG z-20)
                  // が列ヘッダー (sticky z-20) の上に描画されるのを防ぐ (#116)
                  'relative isolate',
                  // 別制作物からの D&D 移動ターゲットをハイライト (#52)
                  drag?.mode === 'move' &&
                    drag.targetItemId === item.id &&
                    drag.plan.itemId !== item.id &&
                    'bg-primary/10 ring-2 ring-inset ring-primary',
                )}
                style={{ height: totalHeight }}
              >
                {/* 日付セル (クリックで単日作成 / 縦ドラッグで期間作成) */}
                {days.map((d, i) => {
                  const t = dayTones[i]!;
                  const inRange =
                    createDrag !== null &&
                    createDrag.itemId === item.id &&
                    i >= Math.min(createDrag.startIdx, createDrag.endIdx) &&
                    i <= Math.max(createDrag.startIdx, createDrag.endIdx);
                  return (
                    <button
                      key={i}
                      type="button"
                      onPointerDown={(e) => {
                        if (e.button === 0) {
                          setCreateDrag({ itemId: item.id, startIdx: i, endIdx: i });
                        }
                      }}
                      onPointerEnter={() =>
                        setCreateDrag((cd) =>
                          cd && cd.itemId === item.id ? { ...cd, endIdx: i } : cd,
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenCreate(d, item.id);
                        }
                      }}
                      className={cn(
                        'absolute left-0 right-0 border-b border-border/70 transition-colors hover:bg-accent/30',
                        t.tone,
                        t.first && 'border-t-2 border-t-foreground/20',
                        inRange && 'bg-primary/15',
                      )}
                      style={{ top: i * rowHeight, height: rowHeight }}
                      aria-label={`${format(d, 'M/d')} に予定を作成`}
                    />
                  );
                })}

                {/* ボール */}
                {itemPlans.map((plan) => (
                  <BallChip
                    key={plan.id}
                    plan={plan}
                    days={days}
                    rowHeight={rowHeight}
                    laneWidth={laneWidth}
                    lane={laneOf.get(plan.id) ?? 0}
                    today={today}
                    drag={drag?.plan.id === plan.id ? drag : null}
                    linkTarget={linkDrag?.targetId === plan.id}
                    hasSuccessor={plan.successorPlanId !== null}
                    hasPredecessor={predecessorTargetIds.has(plan.id)}
                    inChain={chain?.chainIds.has(plan.id) ?? false}
                    copying={copyingPlanId === plan.id}
                    onActivate={() => onOpenDetail(plan.id)}
                    onCopy={() => onCopy(plan)}
                    onHoverChange={setHoveredPlanId}
                    onPointerDownConnector={(e) => startLink(e, plan)}
                    onPointerDownBall={(e, mode) => {
                      e.stopPropagation();
                      if (plan.status !== 'active' && mode !== 'move') return;
                      setDrag({
                        plan,
                        mode,
                        startClientY: e.clientY,
                        dayDelta: 0,
                        moved: false,
                        targetItemId: plan.itemId,
                      });
                    }}
                  />
                ))}

                {/* 後続コネクト (同一列内) を線で可視化。チップより後ろに描き前面に出す */}
                <LinkLayer
                  plans={itemPlans}
                  laneOf={laneOf}
                  days={days}
                  rowHeight={rowHeight}
                  laneWidth={laneWidth}
                  width={colWidth}
                  height={totalHeight}
                  highlightSourceIds={chain?.linkSourceIds ?? null}
                  dimOthers={chain !== null}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>

      {/* 紐づけドラッグのプレビュー線 (ビューポート基準) */}
      {linkDrag && (
        <svg className="pointer-events-none fixed inset-0 z-50 h-full w-full">
          <line
            x1={linkDrag.start.x}
            y1={linkDrag.start.y}
            x2={linkDrag.pointer.x}
            y2={linkDrag.pointer.y}
            strokeWidth={2}
            strokeDasharray="4 3"
            className={linkDrag.targetId ? 'stroke-primary' : 'stroke-muted-foreground'}
          />
        </svg>
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// 後続リンク描画 (列内 SVG オーバーレイ)
// -----------------------------------------------------------------------------

function chipCenters(
  plan: Plan,
  days: Date[],
  rowHeight: number,
  laneWidth: number,
  laneOf: Map<string, number>,
) {
  const { start, end } = planRange(plan);
  const startIdx = dayIndex(days, start);
  const endIdx = dayIndex(days, end);
  const { top, bottom } = chipVerticalBounds(startIdx, endIdx, rowHeight);
  const lane = laneOf.get(plan.id) ?? 0;
  const cx = lane * laneWidth + 6 + (laneWidth - 12) / 2;
  return { cx, top, bottom };
}

function LinkLayer({
  plans,
  laneOf,
  days,
  rowHeight,
  laneWidth,
  width,
  height,
  highlightSourceIds,
  dimOthers,
}: {
  plans: Plan[];
  laneOf: Map<string, number>;
  days: Date[];
  rowHeight: number;
  laneWidth: number;
  width: number;
  height: number;
  // チェーン強調対象 (先行 plan の id 集合)。null ならホバー強調なし
  highlightSourceIds: Set<string> | null;
  // ホバー中、チェーン外のリンクを減光するか
  dimOthers: boolean;
}) {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const links: { x1: number; y1: number; x2: number; y2: number; sourceId: string }[] = [];
  for (const p of plans) {
    if (!p.successorPlanId) continue;
    const succ = byId.get(p.successorPlanId);
    if (!succ) continue; // 別制作物 or 未ロード
    const a = chipCenters(p, days, rowHeight, laneWidth, laneOf);
    const b = chipCenters(succ, days, rowHeight, laneWidth, laneOf);
    links.push({ x1: a.cx, y1: a.bottom, x2: b.cx, y2: b.top, sourceId: p.id });
  }
  if (links.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20"
      width={width}
      height={height}
      style={{ overflow: 'visible' }}
      aria-hidden
    >
      <defs>
        <marker id="succ-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" className="fill-sky-500" />
        </marker>
        <marker
          id="succ-arrow-hl"
          markerWidth="8"
          markerHeight="8"
          refX="5.5"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" className="fill-sky-600" />
        </marker>
      </defs>
      {links.map((l, i) => {
        const midY = (l.y1 + l.y2) / 2;
        const d = `M ${l.x1} ${l.y1} C ${l.x1} ${midY}, ${l.x2} ${midY}, ${l.x2} ${l.y2}`;
        const highlighted = highlightSourceIds?.has(l.sourceId) ?? false;
        const dimmed = dimOthers && !highlighted;
        return (
          <g key={i} className={cn(dimmed && 'opacity-30')}>
            {/* 白い裏地 (halo): 背景色差に負けず線を浮き立たせる */}
            <path
              d={d}
              strokeWidth={highlighted ? 5 : 4}
              className="fill-none stroke-background opacity-80"
            />
            <path
              d={d}
              strokeWidth={highlighted ? 2.5 : 2}
              strokeDasharray="4 3"
              markerEnd={highlighted ? 'url(#succ-arrow-hl)' : 'url(#succ-arrow)'}
              className={cn('fill-none', highlighted ? 'stroke-sky-600' : 'stroke-sky-500')}
            />
          </g>
        );
      })}
    </svg>
  );
}

// -----------------------------------------------------------------------------
// Ball chip
// -----------------------------------------------------------------------------

function BallChip({
  plan,
  days,
  rowHeight,
  laneWidth,
  lane,
  today,
  drag,
  linkTarget,
  hasSuccessor,
  hasPredecessor,
  inChain,
  copying,
  onActivate,
  onCopy,
  onHoverChange,
  onPointerDownBall,
  onPointerDownConnector,
}: {
  plan: Plan;
  days: Date[];
  rowHeight: number;
  laneWidth: number;
  lane: number;
  today: Date;
  drag: DragState | null;
  linkTarget: boolean;
  hasSuccessor: boolean;
  hasPredecessor: boolean;
  inChain: boolean;
  copying: boolean;
  onActivate: () => void;
  onCopy: () => void;
  onHoverChange: (planId: string | null) => void;
  onPointerDownBall: (e: React.PointerEvent, mode: DragState['mode']) => void;
  onPointerDownConnector: (e: React.PointerEvent) => void;
}) {
  const { start, end } = planRange(plan);
  let startIdx = dayIndex(days, start);
  let endIdx = dayIndex(days, end);

  // ドラッグ中のライブプレビュー
  if (drag) {
    if (drag.mode === 'move') {
      startIdx += drag.dayDelta;
      endIdx += drag.dayDelta;
    } else if (drag.mode === 'resize-top') {
      startIdx = Math.min(endIdx, startIdx + drag.dayDelta);
    } else if (drag.mode === 'resize-bottom') {
      endIdx = Math.max(startIdx, endIdx + drag.dayDelta);
    }
  }

  const { top, height } = chipVerticalBounds(startIdx, endIdx, rowHeight);
  const tier = ballTier(height);
  const style = CATEGORY_STYLE[plan.category];
  const completed = plan.status === 'completed';
  const tossed = plan.ballState === 'tossed';
  const overdue = isOverdue(plan, today);
  const active = isActiveNow(plan, today);
  const editable = plan.status === 'active';

  // TOSS 済みは「相手に渡し終えた＝自分の作業は完了」をグレーで表現
  const cardClass = completed
    ? 'border-slate-200 bg-slate-100/80 text-slate-500 opacity-60'
    : overdue
      ? 'border-red-400 bg-red-50 text-red-700'
      : tossed
        ? 'border-slate-300 bg-slate-100 text-slate-600'
        : cn(style.bg, style.border, style.text);

  // リング表現は排他にして色の衝突を避ける (紐づけ対象 > チェーン > 進行中)
  const ringClass = linkTarget
    ? 'ring-2 ring-primary ring-offset-1'
    : inChain
      ? 'ring-2 ring-sky-500'
      : active && !completed
        ? 'ring-2 ring-primary/40'
        : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate(); // キーボードでは詳細を開く (移動はマウスのみ)
        }
      }}
      data-plan-id={plan.id}
      onPointerDown={(e) => onPointerDownBall(e, 'move')}
      onPointerEnter={() => onHoverChange(plan.id)}
      onPointerLeave={() => onHoverChange(null)}
      className={cn(
        'group absolute overflow-hidden rounded-md border px-2 py-1 text-xs shadow-sm',
        cardClass,
        ringClass,
        drag?.mode === 'move' && 'opacity-70',
        editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
      )}
      style={{
        top,
        height,
        left: lane * laneWidth + 6,
        width: laneWidth - 12,
      }}
    >
      {/* リサイズハンドル (上)。単日/短期の予定 (mini) でも掴んで期間変更できるよう
          tier に依らず表示する (#113)。 */}
      {editable && (
        <div
          onPointerDown={(e) => onPointerDownBall(e, 'resize-top')}
          className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize"
          aria-hidden
        />
      )}

      {/* 複製ボタン (ホバー表示 #51)。カード右上に重ねる。 */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
        disabled={copying}
        className="absolute right-0.5 top-0.5 z-10 rounded bg-background/80 p-0.5 text-foreground/70 opacity-0 shadow-sm transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        aria-label="複製"
        title="複製"
      >
        {copying ? <Loader2 className="size-3 animate-spin" /> : <Copy className="size-3" />}
      </button>

      {/* 先行コネクトの受け口 (上端中央): 先行予定がある場合に常時表示する線の終点アンカー */}
      {hasPredecessor && (
        <div
          className="pointer-events-none absolute left-1/2 top-0 z-10 size-2.5 -translate-x-1/2 rounded-full border-2 border-background bg-sky-500 shadow"
          aria-hidden
        />
      )}

      <div className="flex items-center justify-between gap-1">
        <span className="line-clamp-1 font-medium">{plan.title}</span>
        {completed && <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />}
      </div>

      {tier !== 'mini' && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] opacity-90">
          <span className="rounded bg-black/5 px-1">{style.label}</span>
          <span className="line-clamp-1">
            {format(parseISO(start), 'M/d')}
            {start !== end && `〜${format(parseISO(end), 'M/d')}`}
          </span>
        </div>
      )}

      {tier === 'normal' && (
        <div className="mt-1 border-t border-current/10 pt-1 text-[10px] leading-tight">
          <div className="flex items-center gap-1">
            <span className="opacity-60">実施者</span>
            <span className="line-clamp-1 font-medium">{plan.executor?.name ?? '—'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="opacity-60">{plan.approver ? '承認者' : '進行責任者'}</span>
            <span className="line-clamp-1 font-medium">
              {(plan.approver ?? plan.progressManager)?.name ?? '—'}
            </span>
            {plan.ballHolder && (
              <Badge variant="secondary" className="ml-auto px-1 py-0 text-[9px]">
                {plan.ballHolder.name}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* リサイズハンドル (下)。単日/短期の予定 (mini) でも掴んで期間変更できるよう
          tier に依らず表示する (#113)。後続紐づけハンドル (z-20) より下に置く。 */}
      {editable && (
        <div
          onPointerDown={(e) => onPointerDownBall(e, 'resize-bottom')}
          className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize"
          aria-hidden
        />
      )}

      {/* 後続コネクトの起点 (下端中央): 後続予定がある場合に常時表示する線の起点アンカー。
          編集可・mini以外ではホバー時に作成/張り替えハンドルへ譲る。 */}
      {hasSuccessor && (
        <div
          className={cn(
            'pointer-events-none absolute bottom-0 left-1/2 z-10 size-2.5 -translate-x-1/2 rounded-full border-2 border-background bg-sky-500 shadow',
            editable && tier !== 'mini' && 'transition-opacity group-hover:opacity-0',
          )}
          aria-hidden
        />
      )}

      {/* 後続紐づけハンドル (下端中央): ドラッグして別カードに重ねると後続に設定/張り替え */}
      {editable && tier !== 'mini' && (
        <div
          onPointerDown={onPointerDownConnector}
          className="absolute bottom-0 left-1/2 z-20 size-3 -translate-x-1/2 cursor-crosshair rounded-full border-2 border-background bg-sky-500 opacity-0 shadow transition-opacity group-hover:opacity-100"
          title={hasSuccessor ? 'ドラッグして後続予定を張り替え' : 'ドラッグして後続予定に紐づけ'}
          aria-hidden
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Zoom control
// -----------------------------------------------------------------------------

function ZoomControl({
  rowHeight,
  onChange,
}: {
  rowHeight: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-lg border border-border bg-background p-3 shadow-lg">
      <button
        type="button"
        aria-label="縮小"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => onChange(Math.max(ROW_HEIGHT_MIN, rowHeight - ROW_HEIGHT_STEP))}
      >
        <ZoomOut className="size-4" />
      </button>
      <input
        type="range"
        min={ROW_HEIGHT_MIN}
        max={ROW_HEIGHT_MAX}
        step={ROW_HEIGHT_STEP}
        value={rowHeight}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 accent-primary"
        aria-label="行の高さ"
      />
      <button
        type="button"
        aria-label="拡大"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => onChange(Math.min(ROW_HEIGHT_MAX, rowHeight + ROW_HEIGHT_STEP))}
      >
        <ZoomIn className="size-4" />
      </button>
      <span className="ml-1 min-w-[2.5rem] text-xs text-muted-foreground">{rowHeight}px</span>
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
