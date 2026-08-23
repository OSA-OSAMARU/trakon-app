import { beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { ProjectListPage } from './ProjectListPage';
import type { ProjectSummary } from './api';

// supabase はモックして getSession を固定 (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }),
    },
  },
}));

// Radix UI が jsdom に無い API を呼ぶため shim する。
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const baseProject: ProjectSummary = {
  id: 'p1',
  name: 'サンプル制作案件',
  startDate: '2026-06-01',
  endDate: '2026-07-31',
  status: 'active',
  archivedAt: null,
  role: 'director',
  clientName: null,
  progressManager: null,
  overdueCount: 0,
  createdBy: 'u1',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

const secondProject: ProjectSummary = {
  ...baseProject,
  id: 'p2',
  name: '二つ目の案件',
  role: 'member',
  status: 'closed',
};

/** active / archived の 2 種類の GET /projects を 1 ハンドラで出し分ける。 */
function stubProjects(active: ProjectSummary[], archived: ProjectSummary[] = []) {
  server.use(
    http.get('*/api/v1/projects', ({ request }) => {
      const url = new URL(request.url);
      const data = url.searchParams.get('archived') === 'true' ? archived : active;
      return HttpResponse.json({ data });
    }),
  );
}

describe('ProjectListPage (integration)', () => {
  it('ローディング中はスケルトンを表示する', async () => {
    let resolve!: (v: Response) => void;
    server.use(
      http.get(
        '*/api/v1/projects',
        () => new Promise<Response>((r) => {
          resolve = r;
        }),
      ),
    );

    const { container } = renderWithProviders(<ProjectListPage />, { route: '/projects' });

    // スケルトン (animate-pulse) が描画されていること。
    await waitFor(() => {
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });

    // ハングを残さないよう解決しておく。
    resolve(HttpResponse.json({ data: [] }));
  });

  it('複数プロジェクトを一覧描画する', async () => {
    stubProjects([baseProject, secondProject]);

    renderWithProviders(<ProjectListPage />, { route: '/projects' });

    expect(await screen.findByText('サンプル制作案件')).toBeInTheDocument();
    expect(screen.getByText('二つ目の案件')).toBeInTheDocument();

    // カード一覧内に限定して評価する ("進行中" などはタブ名と重複するため)。
    const list = screen.getByRole('list');
    // ロールラベル。
    expect(within(list).getByText('ディレクター')).toBeInTheDocument();
    expect(within(list).getByText('メンバー')).toBeInTheDocument();
    // ステータスバッジ (進行中 / 終了)。
    expect(within(list).getByText('進行中')).toBeInTheDocument();
    expect(within(list).getByText('終了')).toBeInTheDocument();
    // スケジュールリンク。
    const scheduleLinks = within(list).getAllByRole('link', { name: /スケジュール/ });
    expect(scheduleLinks[0]).toHaveAttribute('href', '/projects/p1');
  });

  it('プロジェクトが無い場合は空状態を表示する', async () => {
    stubProjects([]);

    renderWithProviders(<ProjectListPage />, { route: '/projects' });

    expect(await screen.findByText('まだプロジェクトがありません。')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '最初のプロジェクトを作成' }),
    ).toHaveAttribute('href', '/projects/new');
  });

  it('取得失敗時はエラーメッセージを表示する', async () => {
    server.use(
      http.get('*/api/v1/projects', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );

    renderWithProviders(<ProjectListPage />, { route: '/projects' });

    expect(
      await screen.findByText('プロジェクト一覧の取得に失敗しました。'),
    ).toBeInTheDocument();
  });

  it('アーカイブ済みタブへ切り替えるとアーカイブ一覧を表示する', async () => {
    const archivedProject: ProjectSummary = {
      ...baseProject,
      id: 'p3',
      name: 'アーカイブ案件',
      archivedAt: '2026-06-15T00:00:00.000Z',
    };
    stubProjects([baseProject], [archivedProject]);

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<ProjectListPage />, { route: '/projects' });

    await screen.findByText('サンプル制作案件');

    await user.click(screen.getByRole('tab', { name: 'アーカイブ済み' }));

    expect(await screen.findByText('アーカイブ案件')).toBeInTheDocument();
    // バッジの「アーカイブ済み」はタブ名と重複するためカード一覧内で評価する。
    const list = screen.getByRole('list');
    expect(within(list).getByText('アーカイブ済み')).toBeInTheDocument();
  });

  it('アーカイブ済みタブが空のとき専用メッセージを表示する', async () => {
    stubProjects([baseProject], []);

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<ProjectListPage />, { route: '/projects' });

    await screen.findByText('サンプル制作案件');
    await user.click(screen.getByRole('tab', { name: 'アーカイブ済み' }));

    expect(
      await screen.findByText('アーカイブされたプロジェクトはありません。'),
    ).toBeInTheDocument();
  });

  it('ディレクターはアーカイブを確認ダイアログ経由で実行できる', async () => {
    stubProjects([baseProject]);
    let archiveCalled = false;
    server.use(
      http.post('*/api/v1/projects/p1/archive', () => {
        archiveCalled = true;
        return HttpResponse.json({
          data: { ...baseProject, archivedAt: '2026-06-21T00:00:00.000Z' },
        });
      }),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<ProjectListPage />, { route: '/projects' });

    await screen.findByText('サンプル制作案件');

    await user.click(screen.getByRole('button', { name: /アーカイブ/ }));

    // 確認ダイアログが開く。
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('「サンプル制作案件」をアーカイブしますか？'),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'アーカイブする' }));

    await waitFor(() => expect(archiveCalled).toBe(true));
  });

  it('メンバー (非ディレクター) にはアーカイブ操作が出ない', async () => {
    stubProjects([secondProject]);

    renderWithProviders(<ProjectListPage />, { route: '/projects' });

    await screen.findByText('二つ目の案件');
    expect(screen.queryByRole('button', { name: /アーカイブ/ })).not.toBeInTheDocument();
    // 編集リンクは出る (未アーカイブのため)。
    expect(screen.getByRole('link', { name: '編集' })).toHaveAttribute(
      'href',
      '/projects/p2/edit',
    );
  });
});
