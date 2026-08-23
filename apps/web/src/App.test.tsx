import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';

// supabase はモックして getSession を制御する (実 env / 実クライアント生成を回避)。
// getSession の戻り値を差し替えて authed / unauthed の両分岐を駆動する。
// vi.mock はファイル先頭へ巻き上げられるため、参照する変数は vi.hoisted で生成する。
const { getSession, onAuthStateChange } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}));

// Radix UI (Sidebar 等) が jsdom 未実装の API を呼ぶため shim する。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
  p.setPointerCapture = vi.fn();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// App は自前で BrowserRouter を持たず <Routes> のみを描画するため、
// renderWithProviders (MemoryRouter) で route を指定して初期 URL を制御する。
import { App } from './App';

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('App ルートツリー (integration)', () => {
  it('未認証で保護ルートにアクセスすると /login にリダイレクトする', async () => {
    // 保護ルート (/dashboard) → RequireAuth が session=null を検知 → /login へ。
    getSession.mockResolvedValue({ data: { session: null } });
    renderWithProviders(<App />, { route: '/dashboard' });

    // ログイン画面 (TRAKON ロゴ + ログインカード) が表示される。
    expect(await screen.findByRole('heading', { name: 'TRAKON' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('ルート (/) は保護ルート扱いで未認証なら /login へ落ちる', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderWithProviders(<App />, { route: '/' });

    // / → /dashboard へ Navigate → RequireAuth → /login。
    expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('未知のパス (*) も /dashboard 経由で /login にリダイレクトする', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderWithProviders(<App />, { route: '/no-such-page' });

    expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('未認証の公開ルート (/login) はそのままログイン画面を描画する', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderWithProviders(<App />, { route: '/login' });

    expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('認証済みセッションでは保護ルート (/dashboard) を描画する', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 't', user: { id: 'user-1' } } },
    });
    // RequireAuth が叩く /auth/me/sync と Dashboard / Sidebar が叩くエンドポイントをスタブ。
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json({
          data: {
            user: {
              id: 'user-1',
              email: 'taro@example.com',
              fullName: '山田 太郎',
              displayName: '太郎',
            },
            requiresProfileCompletion: false,
          },
        }),
      ),
      http.get('*/api/v1/users/me/dashboard', () =>
        HttpResponse.json({
          data: {
            today: '2026-06-21',
            summary: { todayTaskCount: 0, overdueCount: 0 },
            projects: [],
          },
        }),
      ),
      http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
    );

    renderWithProviders(<App />, { route: '/dashboard' });

    // ダッシュボードのサマリーラベルが描画される (= 保護ルートに入れた)。
    expect(await screen.findByText('作業中')).toBeInTheDocument();
    // ログイン画面には落ちていない。
    expect(screen.queryByRole('heading', { name: 'ログイン' })).not.toBeInTheDocument();
  });

  it('プロフィール未完了の場合は /login?screen=create-account へ誘導する', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 't', user: { id: 'user-1' } } },
    });
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json({
          data: {
            user: {
              id: 'user-1',
              email: 'taro@example.com',
              fullName: null,
              displayName: null,
            },
            requiresProfileCompletion: true,
          },
        }),
      ),
    );

    renderWithProviders(<App />, { route: '/dashboard' });

    // create-account 画面 (プロフィール登録) へ。
    expect(await screen.findByRole('heading', { name: 'プロフィール登録' })).toBeInTheDocument();
  });

  it('セッション解決中はローディングスピナーを表示する', async () => {
    // getSession を未解決の Promise にしてローディング状態を維持する。
    getSession.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<App />, { route: '/dashboard' });

    expect(await screen.findByText('読み込み中…')).toBeInTheDocument();
  });

  it('/projects/:projectId は items 取得中はローディングを表示する', async () => {
    // 認証済みかつ items クエリ未解決 → ProjectRedirectToSchedule の読み込み中表示。
    getSession.mockResolvedValue({
      data: { session: { access_token: 't', user: { id: 'user-1' } } },
    });
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json({
          data: {
            user: { id: 'user-1', email: 'taro@example.com', fullName: '太郎', displayName: '太郎' },
            requiresProfileCompletion: false,
          },
        }),
      ),
      http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
      http.get('*/api/v1/projects/p1/items', () => new Promise(() => {})),
    );

    renderWithProviders(<App />, { route: '/projects/p1' });

    // RequireAuth 通過後、items 取得中に「読み込み中…」が描画される。
    expect(await screen.findByText('読み込み中…')).toBeInTheDocument();
  });

  it('/projects/:projectId は先頭の制作物スケジュールへリダイレクトする', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 't', user: { id: 'user-1' } } },
    });
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json({
          data: {
            user: { id: 'user-1', email: 'taro@example.com', fullName: '太郎', displayName: '太郎' },
            requiresProfileCompletion: false,
          },
        }),
      ),
      http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
      // ProjectRedirectToSchedule と遷移先 ItemSchedulePage が叩くエンドポイント。
      http.get('*/api/v1/projects/p1/items', () =>
        HttpResponse.json({
          data: [
            {
              id: 'it1',
              projectId: 'p1',
              name: 'LP',
              sortOrder: 0,
              startDate: null,
              endDate: null,
              counts: { activePlanCount: 0, completedPlanCount: 0 },
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
        }),
      ),
      http.get('*/api/v1/projects/p1', () =>
        HttpResponse.json({
          data: {
            id: 'p1',
            name: '制作案件A',
            startDate: '2026-06-01',
            endDate: '2026-06-30',
            status: 'active',
            archivedAt: null,
            role: 'director',
            createdBy: 'user-1',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
            counts: { memberCount: 1, itemCount: 1 },
          },
        }),
      ),
      http.get('*/api/v1/projects/p1/members', () => HttpResponse.json({ data: [] })),
      http.get('*/api/v1/projects/p1/plans', () => HttpResponse.json({ data: [] })),
    );

    renderWithProviders(<App />, { route: '/projects/p1' });

    // /projects/p1/items/it1 (ItemSchedulePage) へ遷移し、プロジェクト名が描画される。
    expect(await screen.findAllByText('制作案件A')).not.toHaveLength(0);
  });
});
