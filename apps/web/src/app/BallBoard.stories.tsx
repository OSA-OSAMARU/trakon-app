import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import { addDays, format } from 'date-fns';

import { BALL_BOARD_COLUMNS, ballBoardColumnOf, type BallBoardColumn } from '@trakon/shared';
import type { PlanCategory, PlanState } from '@/features/plans/api';

import { BallBoard, type BoardBall } from './DashboardPage';

// デモデータは Figma node 20:2 の架空名称に揃える。
// 期限超過の判定は「今日」との関係で変わるため実行日基準で組み立てる。
const TODAY = new Date();
const iso = (offset: number) => format(addDays(TODAY, offset), 'yyyy-MM-dd');

const ball = (
  over: Partial<BoardBall> & { planId: string; title: string; ballState: PlanState },
): BoardBall => ({
  projectId: 'p1',
  itemId: 'it1',
  itemName: 'Webサイト',
  projectName: '灯和食品｜ブランドサイト',
  category: 'design' as PlanCategory,
  scheduledDate: iso(-3),
  dueDate: iso(4),
  isOverdue: false,
  holderName: '杉野 遥',
  holderIsMe: false,
  progressManager: { id: 'm3', name: '横山 直樹' },
  ...over,
});

const BALLS: BoardBall[] = [
  ball({
    planId: 'b1',
    title: 'フロントエンド実装',
    ballState: 'in_progress',
    category: 'coding',
    holderName: '青木 蓮',
    dueDate: iso(-2),
    isOverdue: true,
  }),
  ball({
    planId: 'b2',
    title: '原稿整理',
    ballState: 'in_progress',
    category: 'other',
    projectName: '青庭不動産｜採用サイト',
    itemName: '募集要項',
    holderName: '藤原 佳奈',
    dueDate: iso(-1),
    isOverdue: true,
  }),
  ball({
    planId: 'b3',
    title: 'キービジュアル',
    ballState: 'in_progress',
    category: 'wireframe',
    projectName: 'ひより書房｜新刊特設',
  }),
  ball({ planId: 'b4', title: 'Webデザイン', ballState: 'review_pending', holderName: '石原 美咲' }),
  ball({
    planId: 'b5',
    title: '募集要項',
    ballState: 'review_pending',
    projectName: '青庭不動産｜採用サイト',
    holderName: '髙橋 健吾',
  }),
  ball({
    planId: 'b6',
    title: '表紙デザイン',
    ballState: 'sent_back',
    category: 'review',
    projectName: 'ひより書房｜新刊特設',
    holderName: '藤原 佳奈',
  }),
  ball({
    planId: 'b7',
    title: 'ブランドロゴ',
    ballState: 'approved',
    category: 'meeting',
    holderName: '横山 直樹',
  }),
];

function group(balls: BoardBall[]) {
  const map = new Map<BallBoardColumn, BoardBall[]>(
    BALL_BOARD_COLUMNS.map((c) => [c, [] as BoardBall[]]),
  );
  for (const b of balls) {
    const col = ballBoardColumnOf(b.ballState);
    if (col) map.get(col)!.push(b);
  }
  return map;
}

const meta: Meta<typeof BallBoard> = {
  title: 'dashboard/BallBoard',
  component: BallBoard,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="bg-content h-[760px] p-7">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
  args: { byColumn: group(BALLS) },
};

export default meta;
type Story = StoryObj<typeof BallBoard>;

export const Default: Story = {};

/** ボールが 1 つも無い状態 */
export const Empty: Story = { args: { byColumn: group([]) } };
