import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { addDays, differenceInDays, format, isSameDay, isWeekend, parseISO } from 'date-fns';
import { isHoliday } from '@holiday-jp/holiday_jp';
import { CheckCircle2, KanbanSquare, Plus, Settings, ZoomIn, ZoomOut } from 'lucide-react';

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
import { plansApi, plansQueryKey, type Plan } from './api';
import { CATEGORY_STYLE } from './categoryColor';
import { PageHeader } from '@/components/layout/PageHeader';
import { PlanModalsHost } from './PlanModalsHost';
import { DateChangeConfirmModal } from './DateChangeConfirmModal';
import { useReschedulePlan, type ReschedulePatch } from './usePlanReschedule';
import {
  assignLanes,
  ballTier,
  dayIndex,
  isActiveNow,
  isOverdue,
  itemColor,
  LANE_WIDTH,
  MIN_COLUMN_WIDTH,
  planRange,
  ROW_HEIGHT_DEFAULT,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_STEP,
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
  const [, setParams] = useSearchParams();
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT_DEFAULT);
  // 表示する制作物: 'all' か特定 itemId。初期は URL の itemId にフォーカス。
  const [viewItemId, setViewItemId] = useState<string>(itemId);
  useEffect(() => setViewItemId(itemId), [itemId]);

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

  const reschedule = useReschedulePlan(projectId);
  const [pendingMove, setPendingMove] = useState<{ plan: Plan; dayDelta: number } | null>(null);

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
                <SelectItem value="all">すべての制作物</SelectItem>
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
          onResize={commitResize}
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

      <PlanModalsHost projectId={projectId} members={members} plans={plans} fallbackItemId={itemId} />
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
};

function ScheduleBoard({
  days,
  items,
  plansByItem,
  rowHeight,
  onOpenCreate,
  onOpenDetail,
  onMove,
  onResize,
}: {
  days: Date[];
  items: ProjectItem[];
  plansByItem: Map<string, Plan[]>;
  rowHeight: number;
  onOpenCreate: (date: Date, itemId: string, dueDate?: Date) => void;
  onOpenDetail: (planId: string) => void;
  onMove: (plan: Plan, dayDelta: number) => void;
  onResize: (plan: Plan, edge: 'top' | 'bottom', dayDelta: number) => void;
}) {
  const today = new Date();
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  // 空セルの縦ドラッグで期間付き新規作成
  type CreateDrag = { itemId: string; startIdx: number; endIdx: number };
  const [createDrag, setCreateDrag] = useState<CreateDrag | null>(null);
  const createDragRef = useRef<CreateDrag | null>(null);
  createDragRef.current = createDrag;

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
      if (dayDelta !== d.dayDelta || moved !== d.moved) {
        setDrag({ ...d, dayDelta, moved });
      }
    };
    const onPointerUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.mode === 'move') {
        if (!d.moved) onOpenDetail(d.plan.id);
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
  }, [drag, rowHeight, onMove, onResize, onOpenDetail]);

  const totalHeight = days.length * rowHeight;

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
    <div className="flex-1 overflow-auto">
      <div className="flex w-max select-none">
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
                      {format(d, 'EEEEE')}
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
          const colWidth = Math.max(MIN_COLUMN_WIDTH, laneCount * LANE_WIDTH);
          const color = itemColor(item.id);
          // 代表ボール = 最新の active プラン。その現ホルダーを列上部に表示
          const activePlans = itemPlans.filter((p) => p.status === 'active');
          const repHolder = activePlans.length
            ? activePlans[activePlans.length - 1]!.ballHolder
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
                  {repHolder ? (
                    <span className="truncate font-medium text-foreground">
                      {repHolder.organizationName
                        ? `${repHolder.organizationName} ${repHolder.name}`
                        : repHolder.name}
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                </div>
              </div>

              {/* 本体 */}
              <div className="relative" style={{ height: totalHeight }}>
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
                    lane={laneOf.get(plan.id) ?? 0}
                    today={today}
                    drag={drag?.plan.id === plan.id ? drag : null}
                    onActivate={() => onOpenDetail(plan.id)}
                    onPointerDownBall={(e, mode) => {
                      e.stopPropagation();
                      if (plan.status !== 'active' && mode !== 'move') return;
                      setDrag({
                        plan,
                        mode,
                        startClientY: e.clientY,
                        dayDelta: 0,
                        moved: false,
                      });
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Ball chip
// -----------------------------------------------------------------------------

function BallChip({
  plan,
  days,
  rowHeight,
  lane,
  today,
  drag,
  onActivate,
  onPointerDownBall,
}: {
  plan: Plan;
  days: Date[];
  rowHeight: number;
  lane: number;
  today: Date;
  drag: DragState | null;
  onActivate: () => void;
  onPointerDownBall: (e: React.PointerEvent, mode: DragState['mode']) => void;
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

  const top = startIdx * rowHeight + 1;
  const height = (endIdx - startIdx + 1) * rowHeight - 3;
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
      onPointerDown={(e) => onPointerDownBall(e, 'move')}
      className={cn(
        'absolute overflow-hidden rounded-md border px-2 py-1 text-xs shadow-sm',
        cardClass,
        active && !completed && 'ring-2 ring-primary/40',
        drag?.mode === 'move' && 'opacity-70',
        editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
      )}
      style={{
        top,
        height,
        left: lane * LANE_WIDTH + 6,
        width: LANE_WIDTH - 12,
      }}
    >
      {/* リサイズハンドル (上) */}
      {editable && tier !== 'mini' && (
        <div
          onPointerDown={(e) => onPointerDownBall(e, 'resize-top')}
          className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
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
            <span className="opacity-60">FROM</span>
            <span className="line-clamp-1 font-medium">{plan.fromMember?.name ?? '—'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="opacity-60">TO</span>
            <span className="line-clamp-1 font-medium">{plan.toMember?.name ?? '—'}</span>
            {plan.ballHolder && (
              <Badge variant="secondary" className="ml-auto px-1 py-0 text-[9px]">
                {plan.ballHolder.name}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* リサイズハンドル (下) */}
      {editable && tier !== 'mini' && (
        <div
          onPointerDown={(e) => onPointerDownBall(e, 'resize-bottom')}
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
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
