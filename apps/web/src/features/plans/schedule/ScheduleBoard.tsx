import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';

import { cn } from '@/components/ui/utils';

import type { Plan } from '../api';
import { assignLanes, scaledLaneWidth, scaledMinColumnWidth } from '../scheduleLayout';
import { BallChip } from './BallChip';
import { computeChain, isValidLinkTarget, resolveHolders } from './chain';
import { ColumnHeader } from './ColumnHeader';
import { DateAxis } from './DateAxis';
import { computeDayTones } from './dayTones';
import { LinkArrowDefs, LinkLayer } from './LinkLayer';
import type { CreateDrag, DragState, LinkDrag, ScheduleEditing, ScheduleItemRef } from './types';

/**
 * 制作物列スケジュールのボード本体。
 *
 * 縦軸 = プロジェクト期間の日付、横軸 = 制作物列。重なる予定はレーンに自動割当する。
 * `editing` を渡すと編集モード (認証済み画面)、渡さなければ閲覧専用 (共有リンク画面)。
 * 両画面で同じ描画を使うため、以前あった実装の二重管理は無くなっている。
 */
export function ScheduleBoard({
  days,
  items,
  plansByItem,
  rowHeight,
  editing,
  onSelectPlan,
  sheetOpen = false,
  className,
}: {
  days: Date[];
  items: ScheduleItemRef[];
  plansByItem: Map<string, Plan[]>;
  rowHeight: number;
  /** 省略すると閲覧専用になる */
  editing?: ScheduleEditing;
  /** 閲覧専用時のカードクリック */
  onSelectPlan?: (plan: Plan) => void;
  /** 予定シートが開いている間だけ右に余白を作る (#115) */
  sheetOpen?: boolean;
  className?: string;
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

  // 空セルの縦ドラッグで期間付き新規作成
  const [createDrag, setCreateDrag] = useState<CreateDrag | null>(null);
  const createDragRef = useRef<CreateDrag | null>(null);
  createDragRef.current = createDrag;

  const onLink = editing?.onLink;
  const onOpenCreate = editing?.onOpenCreate;
  const onOpenDetail = editing?.onOpenDetail;
  const onMove = editing?.onMove;
  const onMoveToItem = editing?.onMoveToItem;
  const onResize = editing?.onResize;

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
        if (target) onLink?.(ld.source, target);
      }
    };
    window.addEventListener('pointermove', onMovePointer);
    window.addEventListener('pointerup', onUpPointer);
    return () => {
      window.removeEventListener('pointermove', onMovePointer);
      window.removeEventListener('pointerup', onUpPointer);
    };
  }, [linkDrag, plansByItem, onLink]);

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
      if (s === e) onOpenCreate?.(startDate, cd.itemId);
      else onOpenCreate?.(startDate, cd.itemId, endDate);
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
        if (!d.moved) onOpenDetail?.(d.plan.id);
        else if (d.targetItemId && d.targetItemId !== d.plan.itemId)
          onMoveToItem?.(d.plan, d.targetItemId, d.dayDelta);
        else onMove?.(d.plan, d.dayDelta);
      } else {
        onResize?.(d.plan, d.mode === 'resize-top' ? 'top' : 'bottom', d.dayDelta);
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
    () => computeDayTones(days, today),
    // today はマウント時点で固定で良い
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days],
  );

  return (
    <>
      <div className={cn('flex-1 overflow-auto', className)}>
        <div className={cn('relative flex w-max select-none', sheetOpen && 'pr-[440px]')}>
          <LinkArrowDefs />
          <DateAxis
            days={days}
            dayTones={dayTones}
            rowHeight={rowHeight}
            totalHeight={totalHeight}
          />

          {items.map((item) => {
            const itemPlans = (plansByItem.get(item.id) ?? [])
              .slice()
              .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
            const { laneOf, laneCount } = assignLanes(itemPlans);
            const colWidth = Math.max(minColumnWidth, laneCount * laneWidth);
            // 代表ボール保持者 = ライン (後続チェーン) 単位で現在の保持者を導出 (#117)。
            // 後続で繋がっていない予定は別ライン扱いなので、保持者が複数になりうる。
            const repHolders = resolveHolders(itemPlans);
            // コネクト印用: 先行 (誰かの後続として指されている) plan の id 集合
            const predecessorTargetIds = new Set(
              itemPlans.map((p) => p.successorPlanId).filter((id): id is string => id !== null),
            );
            // ホバー中の予定がこの列に属するならチェーンを算出
            const chain =
              activeHoverId && itemPlans.some((p) => p.id === activeHoverId)
                ? computeChain(itemPlans, activeHoverId)
                : null;
            return (
              <div
                key={item.id}
                className="border-grid-border shrink-0 border-r"
                style={{ width: colWidth }}
              >
                <ColumnHeader
                  name={item.name}
                  planCount={itemPlans.length}
                  holders={repHolders}
                  allCompleted={
                    itemPlans.length > 0 && itemPlans.every((p) => p.status === 'completed')
                  }
                />

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
                      'bg-brand-subtle ring-2 ring-brand ring-inset',
                  )}
                  style={{ height: totalHeight }}
                >
                  {/* 日付セル。編集モードではクリックで単日作成 / 縦ドラッグで期間作成。 */}
                  {days.map((d, i) => {
                    const t = dayTones[i]!;
                    const inRange =
                      createDrag !== null &&
                      createDrag.itemId === item.id &&
                      i >= Math.min(createDrag.startIdx, createDrag.endIdx) &&
                      i <= Math.max(createDrag.startIdx, createDrag.endIdx);
                    const cellClass = cn(
                      'border-grid-border absolute right-0 left-0 border-b',
                      t.tone,
                      t.first && 'border-t-grid-border border-t-2',
                    );
                    const cellStyle = { top: i * rowHeight, height: rowHeight };
                    if (!editing) {
                      return <div key={i} className={cellClass} style={cellStyle} aria-hidden />;
                    }
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
                            onOpenCreate?.(d, item.id);
                          }
                        }}
                        className={cn(
                          cellClass,
                          'transition-colors hover:bg-accent/30',
                          inRange && 'bg-brand-subtle',
                        )}
                        style={cellStyle}
                        aria-label={`${format(d, 'M/d')} に予定を作成`}
                      />
                    );
                  })}

                  {/* 閲覧専用では後続リンクをカードより下に敷く (従来どおりの重なり順) */}
                  {!editing && (
                    <LinkLayer
                      plans={itemPlans}
                      laneOf={laneOf}
                      days={days}
                      rowHeight={rowHeight}
                      laneWidth={laneWidth}
                      width={colWidth}
                      height={totalHeight}
                    />
                  )}

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
                      mode={editing ? 'edit' : 'view'}
                      drag={drag?.plan.id === plan.id ? drag : null}
                      linkTarget={linkDrag?.targetId === plan.id}
                      hasSuccessor={plan.successorPlanId !== null}
                      hasPredecessor={predecessorTargetIds.has(plan.id)}
                      inChain={chain?.chainIds.has(plan.id) ?? false}
                      copying={editing?.copyingPlanId === plan.id}
                      onActivate={
                        editing ? () => editing.onOpenDetail(plan.id) : onSelectPlan ? () => onSelectPlan(plan) : undefined
                      }
                      onCopy={() => editing?.onCopy(plan)}
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

                  {/* 編集モードでは後続コネクトをチップより後ろに描き前面に出す */}
                  {editing && (
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
                  )}
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
            className={linkDrag.targetId ? 'stroke-toss-line' : 'stroke-text-tertiary'}
          />
        </svg>
      )}
    </>
  );
}
