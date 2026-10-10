import { describe, expect, it } from 'vitest';

import type { Plan } from './api';
import {
  assignLanes,
  ballTier,
  dayIndex,
  isActiveNow,
  isOverdue,
  planRange,
  zoomScale,
  ROW_HEIGHT_DEFAULT,
  rowHeightToSlider,
  sliderToRowHeight,
} from './scheduleLayout';

function makePlan(overrides: Partial<Plan> & Pick<Plan, 'id' | 'scheduledDate'>): Plan {
  return {
    itemId: 'it1',
    planType: 'toss',
    title: 'Plan',
    category: 'design',
    dueDate: null,
    fromMember: null,
    toMember: null,
    successorPlanId: null,
    status: 'active',
    memo: null,
    ballHolder: null,
    ballState: 'ready',
    latestEvent: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Plan;
}

describe('planRange', () => {
  it('dueDate 未設定なら end は scheduledDate と同日', () => {
    expect(planRange(makePlan({ id: 'a', scheduledDate: '2026-06-01' }))).toEqual({
      start: '2026-06-01',
      end: '2026-06-01',
    });
  });

  it('dueDate があれば end は dueDate', () => {
    expect(
      planRange(makePlan({ id: 'a', scheduledDate: '2026-06-01', dueDate: '2026-06-05' })),
    ).toEqual({ start: '2026-06-01', end: '2026-06-05' });
  });
});

describe('assignLanes', () => {
  it('重ならない予定は同一レーンを再利用する', () => {
    const plans = [
      makePlan({ id: 'a', scheduledDate: '2026-06-01', dueDate: '2026-06-02' }),
      makePlan({ id: 'b', scheduledDate: '2026-06-05', dueDate: '2026-06-06' }),
    ];
    const { laneOf, laneCount } = assignLanes(plans);
    expect(laneOf.get('a')).toBe(0);
    expect(laneOf.get('b')).toBe(0);
    expect(laneCount).toBe(1);
  });

  it('期間が重なる予定は別レーンに割り当てる', () => {
    const plans = [
      makePlan({ id: 'a', scheduledDate: '2026-06-01', dueDate: '2026-06-05' }),
      makePlan({ id: 'b', scheduledDate: '2026-06-03', dueDate: '2026-06-04' }),
    ];
    const { laneOf, laneCount } = assignLanes(plans);
    expect(laneOf.get('a')).toBe(0);
    expect(laneOf.get('b')).toBe(1);
    expect(laneCount).toBe(2);
  });
});

describe('dayIndex', () => {
  const days = [
    new Date(2026, 5, 1),
    new Date(2026, 5, 2),
    new Date(2026, 5, 3),
  ];
  it('一致する日のインデックスを返す', () => {
    expect(dayIndex(days, '2026-06-02')).toBe(1);
  });
  it('範囲外は端にクランプする', () => {
    expect(dayIndex(days, '2026-05-20')).toBe(0);
    expect(dayIndex(days, '2026-07-01')).toBe(2);
  });
});

describe('ballTier', () => {
  it('高さに応じて small/medium/large を返す (Figma node 308:90)', () => {
    expect(ballTier(56)).toBe('small');
    expect(ballTier(111)).toBe('small');
    expect(ballTier(112)).toBe('medium');
    expect(ballTier(168)).toBe('medium');
    expect(ballTier(223)).toBe('medium');
    expect(ballTier(224)).toBe('large');
  });
});

describe('isOverdue', () => {
  const today = new Date(2026, 5, 10);
  it('ready かつ終了日が今日より前なら true', () => {
    expect(isOverdue(makePlan({ id: 'a', scheduledDate: '2026-06-01' }), today)).toBe(true);
  });
  it('ready 以外は false', () => {
    expect(
      isOverdue(makePlan({ id: 'a', scheduledDate: '2026-06-01', ballState: 'tossed' }), today),
    ).toBe(false);
  });
});

describe('isActiveNow', () => {
  const today = new Date(2026, 5, 5);
  it('active かつ本日が期間内なら true', () => {
    expect(
      isActiveNow(
        makePlan({ id: 'a', scheduledDate: '2026-06-01', dueDate: '2026-06-10' }),
        today,
      ),
    ).toBe(true);
  });
  it('completed は false', () => {
    expect(
      isActiveNow(
        makePlan({ id: 'a', scheduledDate: '2026-06-01', dueDate: '2026-06-10', status: 'completed' }),
        today,
      ),
    ).toBe(false);
  });
});

describe('zoomScale', () => {
  it('zoomScale は基準 40 で 1.0', () => {
    expect(zoomScale(40)).toBe(1);
    expect(zoomScale(20)).toBe(0.5);
  });

  it('既定の行高は基準から 1 段階縮小した 35 (#268)', () => {
    expect(ROW_HEIGHT_DEFAULT).toBe(35);
    expect(zoomScale(ROW_HEIGHT_DEFAULT)).toBe(0.875);
  });
});

describe('ズームスライダーの目盛り (#268)', () => {
  it('既定の行高 (35) がつまみの真ん中、両端が最小 / 最大', () => {
    expect(rowHeightToSlider(35)).toBe(50);
    expect(rowHeightToSlider(20)).toBe(0);
    expect(rowHeightToSlider(80)).toBe(100);
    expect(sliderToRowHeight(50)).toBe(35);
    expect(sliderToRowHeight(0)).toBe(20);
    expect(sliderToRowHeight(100)).toBe(80);
  });

  it('つまみ位置 → 行高は 5px 刻みに丸め、範囲外は端に寄せる', () => {
    expect(sliderToRowHeight(10)).toBe(25); // 20 + 3 = 23 → 25
    expect(sliderToRowHeight(60)).toBe(45); // 35 + 9 = 44 → 45
    expect(sliderToRowHeight(-5)).toBe(20);
    expect(sliderToRowHeight(120)).toBe(80);
  });

  it('全段階で行高 → 位置 → 行高が元に戻る', () => {
    for (let h = 20; h <= 80; h += 5) {
      expect(sliderToRowHeight(rowHeightToSlider(h))).toBe(h);
    }
  });
});
