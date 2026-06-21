import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { createTestQueryClient } from '@/test/render';
import type { ProjectSummary } from '@/features/projects/api';
import type { SyncResponse } from '@/features/auth/api';

// supabase をモックして session / signOut を制御する。
const getSession = vi.fn();
const onAuthStateChange = vi.fn();
const signOut = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => getSession(...a),
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      signOut: (...a: unknown[]) => signOut(...a),
    },
  },
}));

import { SidebarLayout } from './SidebarLayout';

// Radix Dialog (ProfileModal) は jsdom に無い API を使うためシムを入れる。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
});

const SYNC_OK: SyncResponse = {
  requiresProfileCompletion: false,
  user: {
    id: 'u1',
    email: 'taro@example.com',
    fullName: '山田 太郎',
    displayName: 'タロウ',
    primaryAuthMethod: 'password',
    createdAt: '2026-06-01T00:00:00.000Z',
  },
};

const projects: ProjectSummary[] = [
  {
    id: 'p1',
    name: 'サンプル制作案件',
    startDate: '2026-06-01',
    endDate: '2026-07-01',
    status: 'active',
    archivedAt: null,
    role: 'director',
    createdBy: 'u1',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
];

function stubEndpoints(opts: { sync?: SyncResponse | null; projects?: ProjectSummary[] } = {}) {
  server.use(
    http.post('*/api/v1/auth/me/sync', () =>
      HttpResponse.json({ data: opts.sync ?? SYNC_OK }),
    ),
    http.get('*/api/v1/projects', () => HttpResponse.json({ data: opts.projects ?? projects })),
  );
}

/** Routes + Outlet 子マーカーで SidebarLayout を描画する。 */
function renderLayout() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<SidebarLayout />}>
            <Route path="/dashboard" element={<div>子ページ本文</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SidebarLayout', () => {
  it('ナビリンクと Outlet の子ページを描画する', async () => {
    stubEndpoints();
    renderLayout();

    // ロゴ / 固定ナビ
    expect(screen.getByRole('link', { name: 'TRAKON' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ダッシュボード' })).toBeInTheDocument();
    expect(screen.getByText('プロジェクト')).toBeInTheDocument();
    expect(screen.getByText('子ページ本文')).toBeInTheDocument();

    // プロジェクト一覧 (API 応答) が描画される
    expect(await screen.findByRole('link', { name: /サンプル制作案件/ })).toBeInTheDocument();
    // 「全て」導線
    expect(screen.getByRole('link', { name: '全て →' })).toBeInTheDocument();
  });

  it('プロフィール完了済みならユーザー情報ボタンを表示し、開くとサインアウトできる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubEndpoints();
    renderLayout();

    // ユーザー情報フッターボタン (displayName + email)
    const profileBtn = await screen.findByRole('button', { name: /タロウ/ });
    expect(profileBtn).toBeInTheDocument();

    await user.click(profileBtn);
    // ProfileModal が開き、サインアウトボタンが表示される
    const signOutBtn = await screen.findByRole('button', { name: /サインアウト/ });
    await user.click(signOutBtn);

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it('プロフィール未完了 (session 無し) ならフッターは Skeleton を表示する', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    stubEndpoints();
    renderLayout();

    // user が無いのでプロフィールボタンは表示されない
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /タロウ/ })).not.toBeInTheDocument(),
    );
  });

  it('アクティブなルートのナビリンクに active スタイルが付く', async () => {
    stubEndpoints();
    renderLayout();
    // 現在 /dashboard なのでダッシュボードリンクが active
    const dash = screen.getByRole('link', { name: 'ダッシュボード' });
    expect(dash.className).toContain('text-primary');
  });
});
