import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import type { ProjectMember } from '@/features/projects/membersApi';
import type { ProjectItem } from '@/features/projects/api';
import type { MemberRef, Plan } from './api';
import { MemberKanbanTab } from './MemberKanbanTab';

// sonner の toast を spy する (テスト DOM 上に Toaster を置かず副作用だけ検証)。
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

// supabase はモックして getSession を固定 (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'user-1' } } } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
    },
  },
}));

// Radix / jsdom が未実装の API を shim する。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
  p.setPointerCapture = vi.fn();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// -----------------------------------------------------------------------------
// テストデータ
// -----------------------------------------------------------------------------

const memberRef = (over: Partial<MemberRef> = {}): MemberRef => ({
  id: 'm1',
  name: '山田 太郎',
  organizationName: 'Acme',
  memberType: 'production',
  ...over,
});

const member = (over: Partial<ProjectMember> = {}): ProjectMember => ({
  id: 'm1',
  userId: 'u1',
  name: '山田 太郎',
  email: 'taro@example.com',
  organizationName: 'Acme',
  memberType: 'production',
  jobTitle: null,
  sortOrder: 0,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'plan-1',
  itemId: 'it1',
  planType: 'toss',
  title: 'デザイン作成',
  category: 'design',  colorTheme: null,

  scheduledDate: '2026-06-10',
  dueDate: null,
  executor: memberRef(),
  approver: memberRef({ id: 'm2', name: '鈴木 花子', memberType: 'client' }),
  progressManager: memberRef(),
  fromMember: memberRef(),
  toMember: memberRef({ id: 'm2', name: '鈴木 花子', memberType: 'client' }),
  successorPlanId: null,
  status: 'active',
  memo: null,
  ballHolder: memberRef(),
  ballState: 'in_progress',
  latestEvent: null,
  completedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

const PROD = member({ id: 'm1', name: '山田 太郎', memberType: 'production' });
const CLIENT = member({
  id: 'm2',
  name: '鈴木 花子',
  memberType: 'client',
  organizationName: 'クライアント社',
});

const ITEMS: ProjectItem[] = [
  { id: 'it1', name: 'LP制作' } as ProjectItem,
  { id: 'it2', name: 'バナー' } as ProjectItem,
];

function stub(opts: { items?: ProjectItem[]; plans?: Plan[]; plansError?: boolean } = {}) {
  server.use(
    http.get('*/api/v1/projects/p1/items', () =>
      HttpResponse.json({ data: opts.items ?? ITEMS }),
    ),
    http.get('*/api/v1/projects/p1/plans', () => {
      if (opts.plansError)
        return HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'x' } },
          { status: 500 },
        );
      return HttpResponse.json({ data: opts.plans ?? [] });
    }),
  );
}

function renderBoard(
  props: Partial<React.ComponentProps<typeof MemberKanbanTab>> = {},
  onChangeItem = vi.fn(),
) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/projects/:projectId/members"
        element={
          <MemberKanbanTab
            projectId="p1"
            members={[PROD, CLIENT]}
            selectedItemId={null}
            onChangeItem={onChangeItem}
            {...props}
          />
        }
      />
    </Routes>,
    { route: '/projects/p1/members' },
  );
}

// -----------------------------------------------------------------------------

describe('MemberKanbanTab', () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it('ローディング中はスケルトンを表示する', async () => {
    let resolve!: (v: Response) => void;
    server.use(
      http.get('*/api/v1/projects/p1/items', () => HttpResponse.json({ data: ITEMS })),
      http.get(
        '*/api/v1/projects/p1/plans',
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );

    const { container } = renderBoard();

    await waitFor(() => {
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });
    resolve(HttpResponse.json({ data: [] }));
  });

  it('予定取得失敗時はエラーメッセージを表示する', async () => {
    stub({ plansError: true });
    renderBoard();
    expect(await screen.findByText('予定の取得に失敗しました')).toBeInTheDocument();
  });

  it('制作チーム / クライアントのスイムレーンとメンバー列を描画する', async () => {
    stub({ plans: [] });
    renderBoard();

    expect(await screen.findByText('担当者ボード')).toBeInTheDocument();
    // plans クエリ解決後にレーンが描画される。
    expect(await screen.findByText('制作チーム')).toBeInTheDocument();
    expect(screen.getByText('クライアント')).toBeInTheDocument();
    expect(screen.getByText('山田 太郎')).toBeInTheDocument();
    expect(screen.getByText('鈴木 花子')).toBeInTheDocument();
    // クライアント側の組織名が表示される。
    expect(screen.getByText('クライアント社')).toBeInTheDocument();
    // 担当が無い列は空メッセージ。
    expect(screen.getAllByText('担当中の予定はありません').length).toBeGreaterThan(0);
  });

  it('ボール保持者の列に担当中の予定を表示し、状態バッジ・件数・制作物名を出す', async () => {
    const p = plan({
      id: 'plan-1',
      ballHolder: memberRef({ id: 'm1' }),
      ballState: 'in_progress',
    });
    stub({ plans: [p] });

    renderBoard();

    expect(await screen.findByText('デザイン作成')).toBeInTheDocument();
    // 担当件数バッジ。
    expect(screen.getByText('担当 1 件')).toBeInTheDocument();
    // 状態バッジ (KANBAN_STATE_LABEL) と制作物名。
    expect(screen.getByText('実施中')).toBeInTheDocument();
    expect(screen.getByText('LP制作')).toBeInTheDocument();
    // インラインのトス/完了ボタンは廃止され、カード自体がクリック対象になる (#131)。
    expect(screen.queryByRole('button', { name: /へトス/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /完了/ })).not.toBeInTheDocument();
  });

  it('状態に応じたカンバンバッジ (確認待ち / TOSS待ち / TOSS済) を表示する', async () => {
    const reviewing = plan({ id: 'a', ballState: 'review_pending', ballHolder: memberRef({ id: 'm1' }) });
    const approved = plan({ id: 'b', ballState: 'approved', ballHolder: memberRef({ id: 'm1' }) });
    const tossed = plan({ id: 'c', ballState: 'tossed', ballHolder: memberRef({ id: 'm1' }) });
    stub({ plans: [reviewing, approved, tossed] });

    renderBoard();

    expect(await screen.findByText('確認待ち')).toBeInTheDocument();
    expect(screen.getByText('TOSS待ち')).toBeInTheDocument();
    expect(screen.getByText('TOSS済')).toBeInTheDocument();
  });

  it('overdue (未完了かつ期日超過) の予定は強調表示する', async () => {
    const p = plan({
      id: 'plan-1',
      ballState: 'in_progress',
      ballHolder: memberRef({ id: 'm1' }),
      dueDate: '2020-01-01', // 過去 → overdue
      title: '遅延タスク',
    });
    stub({ plans: [p] });
    renderBoard();

    const title = await screen.findByText('遅延タスク');
    expect(title.className).toContain('text-red-700');
  });

  it('カードクリックで詳細モーダルが開く (URL に planId が乗る)', async () => {
    const p = plan({ id: 'plan-1', ballState: 'in_progress', ballHolder: memberRef({ id: 'm1' }) });
    stub({ plans: [p] });
    server.use(
      http.get('*/api/v1/projects/p1/items/it1/plans/plan-1', () =>
        HttpResponse.json({ data: { plan: p, events: [] } }),
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderBoard();

    // 本体ボタン (タイトルを含むボタン) をクリック。
    const titleEl = await screen.findByText('デザイン作成');
    await user.click(titleEl);
    // ball-detail モーダルが描画される。
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('完了済み予定は履歴セクションに集約され、折りたたみ開閉できる', async () => {
    const done = plan({
      id: 'plan-done',
      title: '完了タスク',
      status: 'completed',
      ballState: 'completed',
      ballHolder: memberRef({ id: 'm1' }),
      completedAt: '2026-06-15T00:00:00.000Z',
    });
    stub({ plans: [done] });

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderBoard();

    // 履歴トグルボタンが出る。
    const toggle = await screen.findByRole('button', { name: /履歴 1 件/ });
    // 既定では閉じているので完了タスクは見えない。
    expect(screen.queryByText('完了タスク')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(await screen.findByText('完了タスク')).toBeInTheDocument();
    // 完了カード内の完了バッジ。
    expect(screen.getByText('完了')).toBeInTheDocument();
  });

  it('完了済みカードをクリックすると詳細モーダルが開く', async () => {
    const done = plan({
      id: 'plan-done',
      itemId: 'it1',
      title: '完了タスク',
      status: 'completed',
      ballState: 'completed',
      ballHolder: memberRef({ id: 'm1' }),
      completedAt: '2026-06-15T00:00:00.000Z',
    });
    stub({ plans: [done] });
    server.use(
      http.get('*/api/v1/projects/p1/items/it1/plans/plan-done', () =>
        HttpResponse.json({ data: { plan: done, events: [] } }),
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /履歴 1 件/ }));
    await user.click(await screen.findByText('完了タスク'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('制作物セレクタを変更すると onChangeItem が呼ばれる', async () => {
    const onChangeItem = vi.fn();
    stub({ plans: [] });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderBoard({}, onChangeItem);

    // セレクタ (制作物あり) が描画されるのを待つ。
    const trigger = await screen.findByRole('combobox');
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'バナー' }));
    expect(onChangeItem).toHaveBeenCalledWith('it2');
  });

  it('selectedItemId 指定時はその制作物の予定だけを表示する', async () => {
    const pIt1 = plan({ id: 'a', itemId: 'it1', title: 'it1の予定', ballHolder: memberRef({ id: 'm1' }) });
    const pIt2 = plan({ id: 'b', itemId: 'it2', title: 'it2の予定', ballHolder: memberRef({ id: 'm1' }) });
    stub({ plans: [pIt1, pIt2] });
    renderBoard({ selectedItemId: 'it1' });

    expect(await screen.findByText('it1の予定')).toBeInTheDocument();
    expect(screen.queryByText('it2の予定')).not.toBeInTheDocument();
  });

  it('制作物が空のときはセレクタを描画しない', async () => {
    stub({ items: [], plans: [] });
    renderBoard();

    await screen.findByText('担当者ボード');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
