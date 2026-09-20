import type { Meta, StoryObj } from '@storybook/react';

import type { Plan } from '../api';
import { CalendarMonthView } from './CalendarMonthView';

const TODAY = new Date('2026-09-20T00:00:00');
const SEPTEMBER = new Date('2026-09-01T00:00:00');

function plan(over: Partial<Plan> & { id: string; title: string; scheduledDate: string }): Plan {
  return {
    itemId: 'item-1',
    planType: 'toss',
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
    ballHolder: { id: 'm-1', name: '杉野 遥', organizationName: '', memberType: 'production' },
    ballState: 'in_progress',
    latestEvent: null,
    completedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as Plan;
}

/**
 * 月表示カレンダー (#66)。**閲覧専用**。
 * 「今月なにがあるか」を俯瞰し、停滞 (期限超過) がどこに固まっているかを示す。
 */
const meta = {
  title: 'plans/CalendarMonthView',
  component: CalendarMonthView,
  parameters: { layout: 'fullscreen' },
  args: {
    today: TODAY,
    initialMonth: SEPTEMBER,
    itemNameById: new Map([
      ['item-1', 'トップページ'],
      ['item-2', '名刺・ツール'],
    ]),
    onSelectPlan: () => {},
  },
} satisfies Meta<typeof CalendarMonthView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 通常の月。期間のある予定は跨る日すべてに出る */
export const Default: Story = {
  args: {
    plans: [
      plan({
        id: 'p1',
        title: 'Webデザイン',
        scheduledDate: '2026-09-21',
        dueDate: '2026-09-24',
      }),
      plan({ id: 'p2', title: '名刺デザイン', itemId: 'item-2', scheduledDate: '2026-09-22', category: 'proposal' }),
      plan({
        id: 'p3',
        title: 'フロントエンド実装',
        scheduledDate: '2026-09-27',
        dueDate: '2026-10-01',
        category: 'coding',
      }),
    ],
  },
};

/** 停滞がある月。合計を上に出し、セルとチップの両方で赤く示す */
export const WithOverdue: Story = {
  args: {
    plans: [
      plan({ id: 'late1', title: 'ロゴ入稿', scheduledDate: '2026-09-10', dueDate: '2026-09-12' }),
      plan({ id: 'late2', title: '原稿確認', scheduledDate: '2026-09-15', category: 'review' }),
      plan({ id: 'ok', title: '撮影', scheduledDate: '2026-09-24', category: 'meeting' }),
    ],
  },
};

/** 1 日に予定が多い月。上限を超えた分は「他 N 件」に畳んで行の高さを揃える */
export const CrowdedDay: Story = {
  args: {
    plans: Array.from({ length: 6 }, (_, i) =>
      plan({ id: `p${i}`, title: `打ち合わせ ${i + 1}`, scheduledDate: '2026-09-16', category: 'meeting' }),
    ),
  },
};

/** 予定が無い月。「読み込み中」と区別できるよう明示する */
export const Empty: Story = { args: { plans: [] } };
