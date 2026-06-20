import { useMemo, useState } from 'react';
import { addDays, differenceInDays, format, isSameDay, isWeekend, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { isHoliday } from '@holiday-jp/holiday_jp';
import { CheckCircle2, ZoomIn, ZoomOut } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/utils';
import { CATEGORY_STYLE } from '@/features/plans/categoryColor';
import type { Plan } from '@/features/plans/api';
import {
  assignLanes,
  ballTier,
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
} from '@/features/plans/scheduleLayout';

const DATE_AXIS_WIDTH = 76;

type ShareItem = { id: string; name: string };

/**
 * 共有リンク (非会員) 向けの「閲覧専用」スケジュールカレンダー (#59)。
 * ItemSchedulePage の ScheduleBoard と同等のレイアウトを描画するが、
 * ドラッグ移動 / TOSS / 完了 / 作成といった操作ハンドラを一切持たず、
 * 操作不能であることをコンポーネント構造として保証する。
 */
export function ShareSchedule({
  project,
  items,
  plans,
}: {
  project: { startDate: string; endDate: string };
  items: ShareItem[];
  plans: Plan[];
}) {
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT_DEFAULT);

  const days = useMemo(() => {
    const start = parseISO(project.startDate);
    const end = parseISO(project.endDate);
    const count = Math.max(0, differenceInDays(end, start) + 1);
    return Array.from({ length: count }, (_, i) => addDays(start, i));
  }, [project.startDate, project.endDate]);

  const plansByItem = useMemo(() => {
    const map = new Map<string, Plan[]>();
    for (const p of plans) {
      const arr = map.get(p.itemId) ?? [];
      arr.push(p);
      map.set(p.itemId, arr);
    }
    return map;
  }, [plans]);

  if (days.length === 0) {
    return (
      <p className="m-8 text-sm text-muted-foreground">プロジェクト期間が設定されていません。</p>
    );
  }
  if (items.length === 0) {
    return <p className="m-8 text-sm text-muted-foreground">表示できる制作物がありません。</p>;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ScheduleBoard days={days} items={items} plansByItem={plansByItem} rowHeight={rowHeight} />
      <ZoomControl rowHeight={rowHeight} onChange={setRowHeight} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Board (read-only)
// -----------------------------------------------------------------------------

function ScheduleBoard({
  days,
  items,
  plansByItem,
  rowHeight,
}: {
  days: Date[];
  items: ShareItem[];
  plansByItem: Map<string, Plan[]>;
  rowHeight: number;
}) {
  const today = new Date();
  const totalHeight = days.length * rowHeight;
  const laneWidth = scaledLaneWidth(rowHeight);
  const minColumnWidth = scaledMinColumnWidth(rowHeight);

  const dayTones = useMemo(
    () =>
      days.map((d) => {
        const weekend = isWeekend(d);
        const holiday = isHoliday(d);
        const isToday = isSameDay(d, today);
        const tone = isToday
          ? 'bg-amber-50'
          : holiday
            ? 'bg-rose-50/60'
            : weekend
              ? 'bg-slate-50'
              : 'bg-background';
        return { weekend, holiday, today: isToday, tone, first: d.getDate() === 1 };
      }),
    // today はマウント時点で固定で良い
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, rowHeight],
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
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
          const activePlans = itemPlans.filter((p) => p.status === 'active');
          const repHolder = activePlans.length
            ? activePlans[activePlans.length - 1]!.ballHolder
            : null;
          return (
            <div key={item.id} className="shrink-0 border-r border-border" style={{ width: colWidth }}>
              {/* 列ヘッダー: 制作物名 ＋ 現在のボール保持者 */}
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
                {/* 日付セル (背景のみ。閲覧専用なので操作不可) */}
                {days.map((d, i) => {
                  const t = dayTones[i]!;
                  return (
                    <div
                      key={i}
                      className={cn(
                        'absolute left-0 right-0 border-b border-border/70',
                        t.tone,
                        t.first && 'border-t-2 border-t-foreground/20',
                      )}
                      style={{ top: i * rowHeight, height: rowHeight }}
                      aria-hidden
                    />
                  );
                })}

                {/* 後続リンク (同一列内) */}
                <LinkLayer
                  plans={itemPlans}
                  laneOf={laneOf}
                  days={days}
                  rowHeight={rowHeight}
                  laneWidth={laneWidth}
                  width={colWidth}
                  height={totalHeight}
                />

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
  const top = startIdx * rowHeight + 1;
  const height = (endIdx - startIdx + 1) * rowHeight - 3;
  const lane = laneOf.get(plan.id) ?? 0;
  const cx = lane * laneWidth + 6 + (laneWidth - 12) / 2;
  return { cx, top, bottom: top + height };
}

function LinkLayer({
  plans,
  laneOf,
  days,
  rowHeight,
  laneWidth,
  width,
  height,
}: {
  plans: Plan[];
  laneOf: Map<string, number>;
  days: Date[];
  rowHeight: number;
  laneWidth: number;
  width: number;
  height: number;
}) {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const links: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const p of plans) {
    if (!p.successorPlanId) continue;
    const succ = byId.get(p.successorPlanId);
    if (!succ) continue; // 別制作物 or 未ロード
    const a = chipCenters(p, days, rowHeight, laneWidth, laneOf);
    const b = chipCenters(succ, days, rowHeight, laneWidth, laneOf);
    links.push({ x1: a.cx, y1: a.bottom, x2: b.cx, y2: b.top });
  }
  if (links.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-0"
      width={width}
      height={height}
      style={{ overflow: 'visible' }}
      aria-hidden
    >
      <defs>
        <marker id="share-succ-arrow" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" className="fill-sky-400" />
        </marker>
      </defs>
      {links.map((l, i) => {
        const midY = (l.y1 + l.y2) / 2;
        const d = `M ${l.x1} ${l.y1} C ${l.x1} ${midY}, ${l.x2} ${midY}, ${l.x2} ${l.y2}`;
        return (
          <path
            key={i}
            d={d}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            markerEnd="url(#share-succ-arrow)"
            className="fill-none stroke-sky-400"
          />
        );
      })}
    </svg>
  );
}

// -----------------------------------------------------------------------------
// Ball chip (read-only)
// -----------------------------------------------------------------------------

function BallChip({
  plan,
  days,
  rowHeight,
  laneWidth,
  lane,
  today,
}: {
  plan: Plan;
  days: Date[];
  rowHeight: number;
  laneWidth: number;
  lane: number;
  today: Date;
}) {
  const { start, end } = planRange(plan);
  const startIdx = dayIndex(days, start);
  const endIdx = dayIndex(days, end);

  const top = startIdx * rowHeight + 1;
  const height = (endIdx - startIdx + 1) * rowHeight - 3;
  const tier = ballTier(height);
  const style = CATEGORY_STYLE[plan.category];
  const completed = plan.status === 'completed';
  const tossed = plan.ballState === 'tossed';
  const overdue = isOverdue(plan, today);
  const active = isActiveNow(plan, today);

  const cardClass = completed
    ? 'border-slate-200 bg-slate-100/80 text-slate-500 opacity-60'
    : overdue
      ? 'border-red-400 bg-red-50 text-red-700'
      : tossed
        ? 'border-slate-300 bg-slate-100 text-slate-600'
        : cn(style.bg, style.border, style.text);

  return (
    <div
      className={cn(
        'absolute overflow-hidden rounded-md border px-2 py-1 text-xs shadow-sm',
        cardClass,
        active && !completed && 'ring-2 ring-primary/40',
      )}
      style={{
        top,
        height,
        left: lane * laneWidth + 6,
        width: laneWidth - 12,
      }}
    >
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
            <span className="line-clamp-1 font-medium">{plan.fromMember?.name ?? '—'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="opacity-60">確認者</span>
            <span className="line-clamp-1 font-medium">{plan.toMember?.name ?? '—'}</span>
            {plan.ballHolder && (
              <Badge variant="secondary" className="ml-auto px-1 py-0 text-[9px]">
                {plan.ballHolder.name}
              </Badge>
            )}
          </div>
        </div>
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
