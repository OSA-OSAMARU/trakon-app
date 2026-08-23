import { isHoliday } from '@holiday-jp/holiday_jp';
import { isSameDay, isWeekend } from 'date-fns';

/** 1 日分の背景・強調の判定結果。日付軸と各列の日付セルで同じものを使う。 */
export type DayTone = {
  weekend: boolean;
  holiday: boolean;
  today: boolean;
  /** 背景色クラス */
  tone: string;
  /** 月初 (区切り線を引く) */
  first: boolean;
};

/** 日付配列から表示トーンを求める。today は呼び出し時点で固定して良い。 */
export function computeDayTones(days: Date[], today: Date): DayTone[] {
  return days.map((d) => {
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
  });
}
