import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addDays, format, subDays, subHours } from 'date-fns';

import type { ProjectDetail } from '@/features/projects/api';
import { projectsQueryKey } from '@/features/projects/api';
import type { ProjectMember } from '@/features/projects/membersApi';

import { BallDetailModal } from './BallDetailModal';
import { plansQueryKey, type BallEvent, type MemberRef, type Plan, type PlanDetail } from './api';

// デモデータは Figma node 20:2 の架空名称に揃える。
const member = (
  id: string,
  name: string,
  organizationName: string,
  memberType: MemberRef['memberType'] = 'production',
): MemberRef => ({ id, name, organizationName, memberType });

const sugino = member('m1', '杉野 遥', '余白デザイン室');
const ishihara = member('m2', '石原 美咲', '株式会社灯和食品', 'client');
const yokoyama = member('m3', '横山 直樹', '余白デザイン室');
const aoki = member('m4', '青木 蓮', '余白デザイン室');

const PROJECT_ID = 'pj1';
const ITEM_ID = 'it1';
const PLAN_ID = 'pl1';

const TODAY = new Date();
const iso = (offset: number) => format(addDays(TODAY, offset), 'yyyy-MM-dd');

const PLAN: Plan = {
  id: PLAN_ID,
  itemId: ITEM_ID,
  planType: 'toss',
  title: 'Webデザイン',
  category: 'design',
  colorTheme: 'violet',
  scheduledDate: iso(0),
  dueDate: iso(3),
  executor: sugino,
  approver: ishihara,
  progressManager: yokoyama,
  fromMember: null,
  toMember: null,
  successorPlanId: 'pl2',
  status: 'active',
  memo: null,
  ballHolder: ishihara,
  ballState: 'review_pending',
  latestEvent: null,
  completedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const SUCCESSOR: Plan = {
  ...PLAN,
  id: 'pl2',
  itemId: 'it2',
  title: 'フロントエンド実装',
  category: 'coding',
  colorTheme: null,
  scheduledDate: iso(4),
  dueDate: iso(9),
  executor: aoki,
  successorPlanId: null,
  ballHolder: aoki,
  ballState: 'in_progress',
};

const event = (
  id: string,
  eventType: BallEvent['eventType'],
  actor: MemberRef,
  occurredAt: Date,
  note: string | null = null,
): BallEvent => ({ id, eventType, source: 'human', actor, occurredAt: occurredAt.toISOString(), note });

const EVENTS: BallEvent[] = [
  event('e1', 'review_requested', sugino, subHours(TODAY, 2)),
  event('e2', 'sent_back', ishihara, subDays(TODAY, 1), 'ロゴの余白をもう少し広く'),
  event('e3', 'review_requested', sugino, subDays(TODAY, 3)),
  event('e4', 'sent_back', ishihara, subDays(TODAY, 4)),
  event('e5', 'approved', ishihara, subDays(TODAY, 7)),
  event('e6', 'tossed', yokoyama, subDays(TODAY, 30)),
];

const MEMBERS: ProjectMember[] = [sugino, ishihara, yokoyama, aoki].map((m, i) => ({
  id: m.id,
  userId: null,
  name: m.name,
  email: null,
  organizationName: m.organizationName,
  memberType: m.memberType,
  jobTitle: null,
  roleType: 'editor',
  sortOrder: i,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}));

const PROJECT: ProjectDetail = {
  id: PROJECT_ID,
  name: 'ブランドサイト制作',
  clientName: '株式会社灯和食品',
  startDate: iso(-30),
  endDate: iso(60),
  status: 'active',
  archivedAt: null,
  role: 'admin',
  createdBy: 'u1',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  progressManager: { id: yokoyama.id, name: yokoyama.name },
  overdueCount: 0,
  counts: { memberCount: 4, itemCount: 2 },
};

const noop = () => {};

/**
 * 実 API を叩かずに描画するため、キャッシュへ直接流し込む。
 * `staleTime: Infinity` で再フェッチも起きない。
 */
function withSeededCache(detail: PlanDetail) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  qc.setQueryData(plansQueryKey.detail(PROJECT_ID, ITEM_ID, PLAN_ID), detail);
  qc.setQueryData(projectsQueryKey.detail(PROJECT_ID), PROJECT);
  return qc;
}

const meta: Meta<typeof BallDetailModal> = {
  title: 'plans/BallDetailModal',
  component: BallDetailModal,
  parameters: { layout: 'fullscreen' },
  args: {
    projectId: PROJECT_ID,
    itemId: ITEM_ID,
    planId: PLAN_ID,
    members: MEMBERS,
    plans: [PLAN, SUCCESSOR],
    onClose: noop,
    onEdit: noop,
    onCopied: noop,
  },
};

export default meta;
type Story = StoryObj<typeof BallDetailModal>;

/** 概要タブ (Figma node 37:2)。確認待ち・後続あり。 */
export const Overview: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={withSeededCache({ plan: PLAN, events: EVENTS })}>
        <div className="h-[900px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** 履歴の無い予定 (作成直後)。空状態の見え方を確認する。 */
export const NoEvents: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={withSeededCache({ plan: PLAN, events: [] })}>
        <div className="h-[900px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** 完了済み・後続なし・メモありの予定。 */
export const Completed: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={withSeededCache({
          plan: {
            ...PLAN,
            status: 'completed',
            ballState: 'completed',
            successorPlanId: null,
            memo: '色校正の結果は共有フォルダに格納済み。',
            fromMember: sugino,
            toMember: ishihara,
            completedAt: TODAY.toISOString(),
          },
          events: EVENTS,
        })}
      >
        <div className="h-[900px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
