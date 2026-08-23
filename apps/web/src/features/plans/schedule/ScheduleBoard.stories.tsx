import type { Meta, StoryObj } from '@storybook/react';
import { addDays, format, parseISO } from 'date-fns';

import type { MemberRef, Plan, PlanCategory } from '../api';
import { ScheduleBoard } from './ScheduleBoard';

// デモデータは Figma node 20:2 の架空名称に揃える
const member = (id: string, name: string, org = '株式会社灯和食品'): MemberRef => ({
  id,
  name,
  organizationName: org,
  memberType: 'production',
});

const sugino = member('m1', '杉野 遥', '余白デザイン室');
const ishihara = member('m2', '石原 美咲');
const yokoyama = member('m3', '横山 直樹', '余白デザイン室');
const fujiwara = member('m4', '藤原 佳奈', '余白デザイン室');
const aoki = member('m5', '青木 蓮', '余白デザイン室');

// 「今日」との位置関係で状態表示 (期限超過 / 進行中 / 本日マーカー) が変わるため、
// デモデータは実行日を基準に組み立てる。
const TODAY = new Date();
const iso = (offset: number) => format(addDays(TODAY, offset), 'yyyy-MM-dd');
const START = iso(-10);

const plan = (over: Partial<Plan> & { id: string; itemId: string; title: string }): Plan => ({
  planType: 'toss',
  category: 'design' as PlanCategory,
  scheduledDate: START,
  dueDate: null,
  executor: sugino,
  approver: ishihara,
  progressManager: yokoyama,
  fromMember: null,
  toMember: null,
  successorPlanId: null,
  status: 'active',
  memo: null,
  ballHolder: sugino,
  ballState: 'in_progress',
  latestEvent: null,
  completedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

const PLANS: Plan[] = [
  plan({
    id: 'p1',
    itemId: 'logo',
    title: 'ブランドロゴ',
    scheduledDate: iso(-10),
    dueDate: iso(-7),
    status: 'completed',
    ballState: 'completed',
  }),
  plan({
    id: 'p2',
    itemId: 'web',
    title: 'Webデザイン',
    scheduledDate: iso(-9),
    dueDate: iso(-6),
    ballState: 'tossed',
    fromMember: yokoyama,
    successorPlanId: 'p3',
  }),
  plan({
    id: 'p3',
    itemId: 'web',
    title: 'フロントエンド実装',
    category: 'coding',
    scheduledDate: iso(-3),
    dueDate: iso(2),
    executor: aoki,
    ballState: 'tossed',
  }),
  plan({
    id: 'p4',
    itemId: 'card',
    title: '名刺デザイン',
    scheduledDate: iso(-8),
    dueDate: iso(-3),
    executor: fujiwara,
    ballState: 'review_pending',
    ballHolder: ishihara,
  }),
  plan({
    id: 'p5',
    itemId: 'book',
    title: 'ブランドブック',
    scheduledDate: iso(-2),
    dueDate: iso(3),
    executor: fujiwara,
  }),
  plan({
    id: 'p6',
    itemId: 'book',
    title: '校正・色確認',
    category: 'review',
    scheduledDate: iso(4),
    dueDate: iso(8),
    executor: fujiwara,
    ballState: 'review_pending',
    ballHolder: ishihara,
  }),
];

const ITEMS = [
  { id: 'logo', name: 'ブランドロゴ' },
  { id: 'web', name: 'Webサイト' },
  { id: 'card', name: '名刺・ツール' },
  { id: 'book', name: 'ブランドブック' },
];

const DAYS = Array.from({ length: 14 }, (_, i) => addDays(parseISO(START), i));

const plansByItem = new Map<string, Plan[]>();
for (const p of PLANS) {
  plansByItem.set(p.itemId, [...(plansByItem.get(p.itemId) ?? []), p]);
}

const noop = () => {};

const meta: Meta<typeof ScheduleBoard> = {
  title: 'plans/ScheduleBoard',
  component: ScheduleBoard,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-[760px] flex-col bg-background">
        <Story />
      </div>
    ),
  ],
  args: {
    days: DAYS,
    items: ITEMS,
    plansByItem,
    rowHeight: 56,
  },
};

export default meta;
type Story = StoryObj<typeof ScheduleBoard>;

/** 共有リンク画面と同じ閲覧専用モード */
export const ReadOnly: Story = {};

/** 認証済み画面と同じ編集モード (ドラッグ・複製・後続紐づけが有効) */
export const Editing: Story = {
  args: {
    editing: {
      onOpenCreate: noop,
      onOpenDetail: noop,
      onMove: noop,
      onMoveToItem: noop,
      onResize: noop,
      onLink: noop,
      onCopy: noop,
      copyingPlanId: null,
    },
  },
};

/** 行高を最小まで縮めた状態 (日付軸・カードの表示段階が落ちる) */
export const ZoomedOut: Story = { args: { rowHeight: 24 } };

/** 行高を最大まで広げた状態 */
export const ZoomedIn: Story = { args: { rowHeight: 80 } };
