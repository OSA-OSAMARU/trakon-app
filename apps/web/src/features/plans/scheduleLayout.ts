import { differenceInCalendarDays, parseISO } from 'date-fns';

import type { Plan } from './api';

/**
 * 制作物列スケジュール (プロトタイプ DeliverableSchedulePage 準拠) の
 * 描画ロジックをまとめた純粋関数群。
 */

export const LANE_WIDTH = 240; // 1 レーン (サブ列) の幅 px
export const MIN_COLUMN_WIDTH = 280; // 制作物列の最小幅 px
export const ROW_HEIGHT_MIN = 20;
export const ROW_HEIGHT_MAX = 80;
export const ROW_HEIGHT_DEFAULT = 40;
export const ROW_HEIGHT_STEP = 5;

/** プラン期間の開始/終了日 (dueDate 未設定なら scheduledDate と同日)。 */
export function planRange(plan: Plan): { start: string; end: string } {
  return { start: plan.scheduledDate, end: plan.dueDate ?? plan.scheduledDate };
}

/**
 * 重なり合うボールを横方向のサブレーンに割り当てる。
 * プロトタイプ assignLanes の移植: 期間が重なるボールは別レーンへ。
 * 入力は scheduledDate 昇順である前提 (BE がソート済み)。
 */
export function assignLanes(plans: Plan[]): {
  laneOf: Map<string, number>;
  laneCount: number;
} {
  const lanes: { end: number }[] = []; // lanes[i].end = そのレーンの最終占有 epoch(ms)
  const laneOf = new Map<string, number>();

  for (const plan of plans) {
    const { start, end } = planRange(plan);
    const startMs = parseISO(start).getTime();
    const endMs = parseISO(end).getTime();

    let assigned = -1;
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      // 重ならない (このレーンの最後の終了が今回の開始より前) なら再利用
      if (lane && lane.end < startMs) {
        assigned = i;
        break;
      }
    }
    if (assigned === -1) {
      lanes.push({ end: endMs });
      assigned = lanes.length - 1;
    } else {
      const lane = lanes[assigned];
      if (lane) lane.end = endMs;
    }
    laneOf.set(plan.id, assigned);
  }

  return { laneOf, laneCount: Math.max(1, lanes.length) };
}

/** days 配列中での日付の行インデックス (範囲外は端にクランプ)。 */
export function dayIndex(days: Date[], isoDate: string): number {
  const first = days[0];
  if (!first) return 0;
  const idx = differenceInCalendarDays(parseISO(isoDate), first);
  if (idx < 0) return 0;
  if (idx > days.length - 1) return days.length - 1;
  return idx;
}

export type BallTier = 'mini' | 'compact' | 'normal';

/** ボール高さから表示段階を決める (プロトタイプ閾値 80 / 120)。 */
export function ballTier(heightPx: number): BallTier {
  if (heightPx < 80) return 'mini';
  if (heightPx < 120) return 'compact';
  return 'normal';
}

/** ボールが期限超過か (ballState=ready かつ 終了日 < 今日)。 */
export function isOverdue(plan: Plan, today: Date): boolean {
  if (plan.ballState !== 'ready') return false;
  const { end } = planRange(plan);
  return parseISO(end).getTime() < startOfDay(today).getTime();
}

/** 本日がボール期間内か (active な進行中ボール)。 */
export function isActiveNow(plan: Plan, today: Date): boolean {
  if (plan.status !== 'active') return false;
  const { start, end } = planRange(plan);
  const t = startOfDay(today).getTime();
  return parseISO(start).getTime() <= t && t <= parseISO(end).getTime();
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * 制作物 id から決定的に色クラスを割り当てる (BE に色フィールドが無いため)。
 * ヘッダーのドット / 列アクセントに使用。
 */
const ITEM_PALETTE = [
  { dot: 'bg-violet-500', accent: 'border-t-violet-400' },
  { dot: 'bg-sky-500', accent: 'border-t-sky-400' },
  { dot: 'bg-emerald-500', accent: 'border-t-emerald-400' },
  { dot: 'bg-amber-500', accent: 'border-t-amber-400' },
  { dot: 'bg-rose-500', accent: 'border-t-rose-400' },
  { dot: 'bg-cyan-500', accent: 'border-t-cyan-400' },
  { dot: 'bg-fuchsia-500', accent: 'border-t-fuchsia-400' },
  { dot: 'bg-lime-500', accent: 'border-t-lime-400' },
] as const;

export function itemColor(itemId: string): (typeof ITEM_PALETTE)[number] {
  let hash = 0;
  for (let i = 0; i < itemId.length; i++) {
    hash = (hash * 31 + itemId.charCodeAt(i)) >>> 0;
  }
  return ITEM_PALETTE[hash % ITEM_PALETTE.length]!;
}
