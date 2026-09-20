import { describe, expect, it } from 'vitest';

import type { Plan } from '../api';
import {
  MAX_CHIPS_PER_DAY,
  buildMonthGrid,
  isEmptyMonth,
  splitDayPlans,
} from './calendarLayout';

const TODAY = new Date('2026-09-20T00:00:00');

function plan(over: Partial<Plan> & { id: string; scheduledDate: string }): Plan {
  return {
    itemId: 'item-1',
    planType: 'toss',
    title: `予定 ${over.id}`,
    category: 'design',
    colorTheme: null,
    dueDate: null,
    executor: null,
    approver: null,
    progressManager: null,
    fromMember: null,
    toMember: null,
    successorPlanId: null,
    status: 'active',
    memo: null,
    ballHolder: null,
    ballState: 'in_progress',
    latestEvent: null,
    completedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as Plan;
}

const SEP = new Date('2026-09-01T00:00:00');

function dayOf(weeks: ReturnType<typeof buildMonthGrid>, iso: string) {
  return weeks.flat().find((d) => d.iso === iso)!;
}

describe('buildMonthGrid', () => {
  it('日曜始まりの 7 日 × 必要な週数を返す', () => {
    const weeks = buildMonthGrid({ month: SEP, plans: [], today: TODAY });

    for (const w of weeks) expect(w).toHaveLength(7);
    expect(weeks[0]![0]!.date.getDay()).toBe(0);
    // 2026-09-01 は火曜。8/30(日) 始まりで 9/30 まで入る 5 週
    expect(weeks[0]![0]!.iso).toBe('2026-08-30');
    expect(weeks).toHaveLength(5);
  });

  it('当月外の日に印を付ける', () => {
    const weeks = buildMonthGrid({ month: SEP, plans: [], today: TODAY });

    expect(dayOf(weeks, '2026-08-31').inMonth).toBe(false);
    expect(dayOf(weeks, '2026-09-01').inMonth).toBe(true);
    expect(dayOf(weeks, '2026-10-01').inMonth).toBe(false);
  });

  it('空の週は足さない (俯瞰の邪魔になるため)', () => {
    // 2026-11-01 は日曜。ちょうど 5 週で 11/30 まで収まる
    const weeks = buildMonthGrid({
      month: new Date('2026-11-01T00:00:00'),
      plans: [],
      today: TODAY,
    });
    expect(weeks).toHaveLength(5);
    expect(weeks.at(-1)!.some((d) => d.iso === '2026-11-30')).toBe(true);
  });

  it('期間のある予定は跨る日すべてに出す', () => {
    const weeks = buildMonthGrid({
      month: SEP,
      plans: [plan({ id: 'p1', scheduledDate: '2026-09-08', dueDate: '2026-09-10' })],
      today: TODAY,
    });

    for (const iso of ['2026-09-08', '2026-09-09', '2026-09-10']) {
      expect(dayOf(weeks, iso).plans.map((p) => p.id)).toEqual(['p1']);
    }
    expect(dayOf(weeks, '2026-09-11').plans).toHaveLength(0);
  });

  it('終了日が無ければ開始日 1 日だけ', () => {
    const weeks = buildMonthGrid({
      month: SEP,
      plans: [plan({ id: 'p1', scheduledDate: '2026-09-08' })],
      today: TODAY,
    });
    expect(dayOf(weeks, '2026-09-08').plans).toHaveLength(1);
    expect(dayOf(weeks, '2026-09-09').plans).toHaveLength(0);
  });

  it('月をまたぐ予定も、表示範囲に入る日には出す', () => {
    const weeks = buildMonthGrid({
      month: SEP,
      plans: [plan({ id: 'p1', scheduledDate: '2026-08-28', dueDate: '2026-09-02' })],
      today: TODAY,
    });
    // 表示範囲の先頭 (8/30) から入っている
    expect(dayOf(weeks, '2026-08-30').plans).toHaveLength(1);
    expect(dayOf(weeks, '2026-09-02').plans).toHaveLength(1);
  });

  it('期限超過をセルごとに数える', () => {
    // 停滞が月のどこに固まっているかを示すのが月表示の存在理由
    const weeks = buildMonthGrid({
      month: SEP,
      plans: [
        plan({ id: 'late', scheduledDate: '2026-09-10', dueDate: '2026-09-12' }),
        plan({ id: 'ok', scheduledDate: '2026-09-10', dueDate: '2026-09-25' }),
      ],
      today: TODAY,
    });

    expect(dayOf(weeks, '2026-09-11').overdueCount).toBe(1);
    expect(dayOf(weeks, '2026-09-25').overdueCount).toBe(0);
  });

  it('完了・TOSS 済みは期限超過に数えない', () => {
    const weeks = buildMonthGrid({
      month: SEP,
      plans: [
        plan({
          id: 'done',
          scheduledDate: '2026-09-10',
          dueDate: '2026-09-12',
          status: 'completed',
        }),
        plan({
          id: 'tossed',
          scheduledDate: '2026-09-10',
          dueDate: '2026-09-12',
          ballState: 'tossed',
        }),
      ],
      today: TODAY,
    });

    expect(dayOf(weeks, '2026-09-11').overdueCount).toBe(0);
    expect(dayOf(weeks, '2026-09-11').plans).toHaveLength(2);
  });
});

describe('splitDayPlans', () => {
  it('上限以下はそのまま', () => {
    const plans = [plan({ id: 'a', scheduledDate: '2026-09-01' })];
    expect(splitDayPlans(plans)).toEqual({ visible: plans, hiddenCount: 0 });
  });

  it('超えた分は畳む (行の高さを揃えるため)', () => {
    const plans = Array.from({ length: MAX_CHIPS_PER_DAY + 2 }, (_, i) =>
      plan({ id: `p${i}`, scheduledDate: '2026-09-01' }),
    );
    const { visible, hiddenCount } = splitDayPlans(plans);
    expect(visible).toHaveLength(MAX_CHIPS_PER_DAY);
    expect(hiddenCount).toBe(2);
  });
});

describe('isEmptyMonth', () => {
  it('1 件も無ければ true', () => {
    expect(isEmptyMonth(buildMonthGrid({ month: SEP, plans: [], today: TODAY }))).toBe(true);
  });

  it('表示範囲に 1 件でもあれば false', () => {
    const weeks = buildMonthGrid({
      month: SEP,
      plans: [plan({ id: 'p1', scheduledDate: '2026-09-08' })],
      today: TODAY,
    });
    expect(isEmptyMonth(weeks)).toBe(false);
  });
});
