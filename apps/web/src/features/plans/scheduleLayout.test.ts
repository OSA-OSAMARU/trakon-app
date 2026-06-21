import { describe, expect, it } from 'vitest';

import type { Plan } from './api';
import {
  assignLanes,
  ballTier,
  dayIndex,
  isActiveNow,
  isOverdue,
  itemColor,
  planRange,
  zoomScale,
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
  it('高さに応じて mini/compact/normal を返す', () => {
    expect(ballTier(40)).toBe('mini');
    expect(ballTier(100)).toBe('compact');
    expect(ballTier(160)).toBe('normal');
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

describe('zoomScale / itemColor', () => {
  it('zoomScale は既定 40 で 1.0', () => {
    expect(zoomScale(40)).toBe(1);
    expect(zoomScale(20)).toBe(0.5);
  });
  it('itemColor は同一 id で決定的', () => {
    expect(itemColor('item-xyz')).toBe(itemColor('item-xyz'));
  });
});
