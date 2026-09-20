import { addDays, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from 'date-fns';

import type { Plan } from '../api';
import { isOverdue, planRange } from '../scheduleLayout';

/**
 * 月表示カレンダーのレイアウト計算 (#66)。
 *
 * 縦型スケジュール (`scheduleLayout.ts`) は「縦が日付・横が制作物」前提の計算で、
 * 月グリッドとは軸が違うため流用できない。ここは**月グリッド専用**の計算を持つ。
 *
 * 目的の違いも意識している。縦型は「工程の連なりと受け渡し」を見るもので、
 * 月表示は「今月なにがあるか」を俯瞰するもの。だから**ラインの接続は描かず**、
 * 代わりに **停滞 (期限超過) を最優先で目立たせる**。
 * 期限超過が月のどこに固まっているかが一目で分かることが、この表示の存在理由。
 */

/** 1 日分のセル。 */
export type CalendarDay = {
  date: Date;
  /** `yyyy-MM-dd` */
  iso: string;
  /** 表示中の月に属する日か。前後の月の日は淡く出す */
  inMonth: boolean;
  /** この日に掛かっている予定 (開始日〜終了日が跨る日をすべて含む) */
  plans: Plan[];
  /** うち期限超過の件数。停滞がどこに固まっているかを示す */
  overdueCount: number;
};

/** 1 週分。常に 7 日。 */
export type CalendarWeek = CalendarDay[];

/**
 * 月グリッドを組み立てる。
 *
 * 週の始まりは日曜。**必要な週数だけ**返す (5 週の月は 5 行)。
 * 日付ピッカー (`components/ui/calendar.tsx`) が常に 6 週を描くのとは逆で、
 * こちらは 1 行が高く場所を取るため、空の行を足すと無駄なスクロールが生まれる。
 */
export function buildMonthGrid(input: {
  month: Date;
  plans: Plan[];
  today: Date;
}): CalendarWeek[] {
  const first = startOfWeek(startOfMonth(input.month), { weekStartsOn: 0 });

  // 日付 → 掛かっている予定。予定ごとに範囲を展開して索引を作る。
  // 月あたりの予定は多くても数百件なので、日ごとに全予定を走査するより安い。
  const byDay = new Map<string, Plan[]>();
  for (const plan of input.plans) {
    const { start, end } = planRange(plan);
    for (let d = parseISO(start); format(d, 'yyyy-MM-dd') <= end; d = addDays(d, 1)) {
      const iso = format(d, 'yyyy-MM-dd');
      const list = byDay.get(iso);
      if (list) list.push(plan);
      else byDay.set(iso, [plan]);
    }
  }

  const weeks: CalendarWeek[] = [];
  for (let w = 0; ; w += 1) {
    const week: CalendarWeek = [];
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(first, w * 7 + i);
      const iso = format(date, 'yyyy-MM-dd');
      const plans = byDay.get(iso) ?? [];
      week.push({
        date,
        iso,
        inMonth: isSameMonth(date, input.month),
        plans,
        overdueCount: plans.filter((p) => isOverdue(p, input.today)).length,
      });
    }
    weeks.push(week);
    // 翌週の先頭が既に翌月なら打ち切る (5 週の月は 5 行で終わる)
    const nextWeekStart = addDays(first, (w + 1) * 7);
    if (!isSameMonth(nextWeekStart, input.month)) break;
    // 念のための上限 (週の始まり次第で最大 6 行)
    if (w >= 5) break;
  }
  return weeks;
}

/**
 * セルに直接並べる件数の上限。これを超えた分は「他 N 件」に畳む。
 *
 * 全部出すと行の高さが日によってばらつき、月全体の形が読めなくなる。
 * 俯瞰が目的なので、**高さを揃えることを優先**する。
 */
export const MAX_CHIPS_PER_DAY = 3;

/** セルに出す分と、畳む件数に分ける。 */
export function splitDayPlans(plans: Plan[]): { visible: Plan[]; hiddenCount: number } {
  if (plans.length <= MAX_CHIPS_PER_DAY) return { visible: plans, hiddenCount: 0 };
  return {
    visible: plans.slice(0, MAX_CHIPS_PER_DAY),
    hiddenCount: plans.length - MAX_CHIPS_PER_DAY,
  };
}

/**
 * 月の表示範囲に予定が 1 件も無いか。
 *
 * 「予定が無い月」と「読み込み中」を画面上で区別するために使う。
 */
export function isEmptyMonth(weeks: CalendarWeek[]): boolean {
  return weeks.every((w) => w.every((d) => d.plans.length === 0));
}
