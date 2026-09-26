import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { MemberRef, Plan, PlanCategory, PlanState } from '@/features/plans/api';

import { SharePage } from './SharePage';
import type { ShareView } from './api';

// デモデータは Figma node 495:306 の架空名称に揃える。
const TODAY = new Date();
const iso = (offset: number) => format(addDays(TODAY, offset), 'yyyy-MM-dd');

const member = (id: string, name: string, organizationName: string): MemberRef => ({
  id,
  name,
  organizationName,
  memberType: 'production',
});

const sugino = member('m1', '杉野 遥', '余白デザイン室');
const ishihara = member('m2', '石原 美咲', '株式会社灯和食品');
const yokoyama = member('m3', '横山 直樹', '余白デザイン室');

const plan = (
  over: Partial<Plan> & { id: string; itemId: string; title: string; ballState: PlanState },
): Plan => ({
  planType: 'toss',
  category: 'design' as PlanCategory,
  colorTheme: null,
  scheduledDate: iso(0),
  dueDate: iso(3),
  executor: sugino,
  approver: ishihara,
  progressManager: yokoyama,
  fromMember: null,
  toMember: null,
  successorPlanId: null,
  status: 'active',
  memo: null,
  ballHolder: sugino,
  latestEvent: null,
  completedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

const view: ShareView = {
  share: {
    id: 's1',
    scopeType: 'project',
    scopeTargetId: null,
    expiresAt: format(addDays(TODAY, 14), "yyyy-MM-dd'T'02:26:00.000'Z'"),
  },
  project: {
    id: 'pj1',
    name: '歌文協様　サイト制作',
    startDate: iso(-2),
    endDate: iso(12),
  },
  items: [
    { id: 'it1', name: 'ブランドロゴ' },
    { id: 'it2', name: 'Webサイト' },
    { id: 'it3', name: '名刺・ツール' },
    { id: 'it4', name: 'ブランドブック' },
    { id: 'it5', name: '動画・撮影' },
  ],
  plans: [
    plan({ id: 'p1', itemId: 'it1', title: 'ブランドロゴ', ballState: 'in_progress' }),
    plan({
      id: 'p2',
      itemId: 'it2',
      title: 'Webデザイン',
      ballState: 'approved',
      colorTheme: 'violet',
      scheduledDate: iso(1),
      dueDate: iso(4),
      ballHolder: yokoyama,
    }),
    plan({
      id: 'p3',
      itemId: 'it3',
      title: '名刺デザイン',
      ballState: 'review_pending',
      colorTheme: 'green',
      scheduledDate: iso(2),
      dueDate: iso(7),
      ballHolder: ishihara,
    }),
    plan({
      id: 'p4',
      itemId: 'it4',
      title: 'ブランドブック',
      ballState: 'in_progress',
      colorTheme: 'amber',
      scheduledDate: iso(3),
      dueDate: iso(8),
    }),
  ],
};

/**
 * 共有リンクの閲覧画面 (Figma node 495:306)。
 * ネットワークは使わず、react-query のキャッシュへ直接流し込んで描画する。
 */
function withView(data: ShareView) {
  // ネットワークへ出ない。staleTime を無限にしてキャッシュだけで描画させる
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(['share', 'demo-token'], data);
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/share/demo-token']}>
        <Routes>
          <Route path="/share/:token" element={<SharePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const meta: Meta<typeof SharePage> = {
  title: 'Share/SharePage',
  component: SharePage,
  // 画面いっぱいの構図を確認したいので、プレビューの余白は外す
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="h-screen">{Story()}</div>],
};
export default meta;

export const Default: StoryObj = { render: () => withView(view) };

export const NoExpiry: StoryObj = {
  name: '有効期限なし',
  render: () => withView({ ...view, share: { ...view.share, expiresAt: null } }),
};

export const ItemScope: StoryObj = {
  name: '制作物単位の共有',
  render: () =>
    withView({
      ...view,
      share: { ...view.share, scopeType: 'item', scopeTargetId: 'it2' },
      items: [{ id: 'it2', name: 'Webサイト' }],
      plans: view.plans.filter((p) => p.itemId === 'it2'),
    }),
};
