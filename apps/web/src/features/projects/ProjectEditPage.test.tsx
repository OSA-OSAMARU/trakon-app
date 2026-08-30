import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { ProjectEditPage } from './ProjectEditPage';
import type { ProjectDetail, ProjectItem } from './api';
import type * as ReactRouterDom from 'react-router-dom';

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

// react-router-dom は部分モックして useNavigate のみ差し替える (MemoryRouter / Routes は本物)。
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof ReactRouterDom>()),
  useNavigate: () => navigateMock,
}));

// sonner の toast は副作用のみなので no-op モックにする。
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Radix UI が jsdom に無い API を呼ぶため shim する。
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  navigateMock.mockClear();
});

/** ポインタチェックを無効化した userEvent をセットアップする。 */
function setup() {
  return userEvent.setup({ pointerEventsCheck: 0 });
}

const detail = (over: Partial<ProjectDetail> = {}): ProjectDetail => ({
  id: 'p1',
  name: 'サイトリニューアル',
  clientName: null,
  progressManager: null,
  overdueCount: 0,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  status: 'active',
  archivedAt: null,
  role: 'admin',
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  counts: { memberCount: 1, itemCount: 1 },
  ...over,
});

const item = (over: Partial<ProjectItem> = {}): ProjectItem => ({
  id: 'it1',
  projectId: 'p1',
  name: 'トップページ',
  sortOrder: 0,
  startDate: null,
  endDate: null,
  counts: { activePlanCount: 0, completedPlanCount: 0 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/** project-detail GET + items GET をスタブする。 */
function stubGets(opts: { project?: Partial<ProjectDetail>; items?: ProjectItem[] } = {}) {
  server.use(
    http.get('*/api/v1/projects/p1', () => HttpResponse.json({ data: detail(opts.project) })),
    http.get('*/api/v1/projects/p1/items', () =>
      HttpResponse.json({ data: opts.items ?? [item()] }),
    ),
  );
}

/** projectId=p1 の ProjectEditPage を <Routes> 配下に描画 (useParams 解決のため)。 */
function renderEdit(route = '/projects/p1/edit') {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId/edit" element={<ProjectEditPage />} />
    </Routes>,
    { route },
  );
}

/** name 属性で input を取得 (DateField は htmlFor 紐付けが無いため)。 */
function inputByName(name: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!el) throw new Error(`input[name="${name}"] が見つかりません`);
  return el;
}

describe('ProjectEditPage (integration)', () => {
  it('projectId が無い場合は NotFound を表示する', () => {
    renderWithProviders(
      <Routes>
        <Route path="/edit" element={<ProjectEditPage />} />
      </Routes>,
      { route: '/edit' },
    );

    expect(screen.getByText('プロジェクトが見つかりませんでした。')).toBeInTheDocument();
  });

  it('ローディング → 取得済みデータでフォームを描画する', async () => {
    stubGets();
    renderEdit();

    // プロジェクト名がヘッダ + 入力欄に反映される。
    expect(await screen.findByText('プロジェクト設定')).toBeInTheDocument();
    await waitFor(() => expect(inputByName('name').value).toBe('サイトリニューアル'));
    expect(inputByName('startDate').value).toBe('2026-01-01');
    expect(inputByName('endDate').value).toBe('2026-12-31');

    // 制作物一覧が描画される。
    expect(await screen.findByText('トップページ')).toBeInTheDocument();

    // 各セクションのカードが描画される。
    expect(screen.getByText('参加者管理')).toBeInTheDocument();
    expect(screen.getByText('共有リンク')).toBeInTheDocument();
  });

  it('取得失敗時は NotFound を表示する', async () => {
    server.use(
      http.get('*/api/v1/projects/p1', () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 }),
      ),
      http.get('*/api/v1/projects/p1/items', () => HttpResponse.json({ data: [] })),
    );

    renderEdit();

    expect(await screen.findByText('プロジェクトが見つかりませんでした。')).toBeInTheDocument();
  });

  it('基本情報を編集して保存すると PATCH が飛び成功トーストが出る', async () => {
    const user = setup();
    let patchBody: unknown = null;
    stubGets();
    server.use(
      http.patch('*/api/v1/projects/p1', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ data: detail({ name: '新サイト' }) });
      }),
    );
    const { toast } = await import('sonner');

    renderEdit();
    await waitFor(() => expect(inputByName('name').value).toBe('サイトリニューアル'));

    const nameInput = inputByName('name');
    await user.clear(nameInput);
    await user.type(nameInput, '新サイト');

    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).toMatchObject({
      name: '新サイト',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'active',
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('プロジェクトを更新しました'));
  });

  it('未編集 (isDirty=false) では保存ボタンが disabled', async () => {
    stubGets();
    renderEdit();
    await waitFor(() => expect(inputByName('name').value).toBe('サイトリニューアル'));
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('バリデーション: 名前を空にすると送信がブロックされエラー表示', async () => {
    const user = setup();
    let posted = false;
    stubGets();
    server.use(
      http.patch('*/api/v1/projects/p1', () => {
        posted = true;
        return HttpResponse.json({ data: detail() });
      }),
    );

    renderEdit();
    await waitFor(() => expect(inputByName('name').value).toBe('サイトリニューアル'));

    // 一旦変更して isDirty にしてから空にする。
    const nameInput = inputByName('name');
    await user.type(nameInput, 'X');
    await user.clear(nameInput);

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('名前は必須')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('サーバエラー系: PATCH 422 でエラートーストが出る', async () => {
    const user = setup();
    stubGets();
    server.use(
      http.patch('*/api/v1/projects/p1', () =>
        HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: '名前が不正です' } },
          { status: 422 },
        ),
      ),
    );
    const { toast } = await import('sonner');

    renderEdit();
    await waitFor(() => expect(inputByName('name').value).toBe('サイトリニューアル'));

    const nameInput = inputByName('name');
    await user.clear(nameInput);
    await user.type(nameInput, '別名');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('名前が不正です'));
  });

  it('制作物を追加できる (ダイアログ → POST → 再取得)', async () => {
    const user = setup();
    let postBody: unknown = null;
    let listCalls = 0;
    server.use(
      http.get('*/api/v1/projects/p1', () => HttpResponse.json({ data: detail() })),
      http.get('*/api/v1/projects/p1/items', () => {
        listCalls += 1;
        const data = listCalls > 1 ? [item(), item({ id: 'it2', name: '会社案内' })] : [item()];
        return HttpResponse.json({ data });
      }),
      http.post('*/api/v1/projects/p1/items', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ data: item({ id: 'it2', name: '会社案内' }) });
      }),
    );

    renderEdit();
    await screen.findByText('トップページ');

    await user.click(screen.getByRole('button', { name: /追加/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('制作物を追加')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('名称'), '会社案内');
    await user.click(within(dialog).getByRole('button', { name: '追加' }));

    await waitFor(() => expect(postBody).toEqual({ name: '会社案内' }));
    expect(await screen.findByText('会社案内')).toBeInTheDocument();
  });

  it('制作物を編集できる (ダイアログ → PATCH)', async () => {
    const user = setup();
    let patchBody: unknown = null;
    stubGets();
    server.use(
      http.patch('*/api/v1/projects/p1/items/it1', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ data: item({ name: 'トップ更新' }) });
      }),
    );
    const { toast } = await import('sonner');

    renderEdit();
    await screen.findByText('トップページ');

    await user.click(screen.getByRole('button', { name: '編集' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('制作物を編集')).toBeInTheDocument();

    const nameField = within(dialog).getByLabelText('名称');
    await user.clear(nameField);
    await user.type(nameField, 'トップ更新');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(patchBody).toEqual({ name: 'トップ更新' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('制作物を更新しました'));
  });

  it('制作物を削除できる (確認 → DELETE → 再取得)', async () => {
    const user = setup();
    let deleteCalled = false;
    let listCalls = 0;
    server.use(
      http.get('*/api/v1/projects/p1', () => HttpResponse.json({ data: detail() })),
      http.get('*/api/v1/projects/p1/items', () => {
        listCalls += 1;
        return HttpResponse.json({ data: listCalls > 1 ? [] : [item()] });
      }),
      http.delete('*/api/v1/projects/p1/items/it1', () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderEdit();
    await screen.findByText('トップページ');

    await user.click(screen.getByRole('button', { name: '削除' }));
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText('「トップページ」を削除しますか？')).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: '削除' }));

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() => expect(screen.queryByText('トップページ')).not.toBeInTheDocument());
  });

  it('制作物が空の場合は空メッセージを表示する', async () => {
    stubGets({ items: [] });
    renderEdit();

    expect(await screen.findByText('まだ制作物がありません。')).toBeInTheDocument();
  });

  it('director の場合はアーカイブ操作ができる (確認 → POST → 一覧へ遷移)', async () => {
    const user = setup();
    let archiveCalled = false;
    stubGets({ project: { role: 'admin', archivedAt: null } });
    server.use(
      http.post('*/api/v1/projects/p1/archive', () => {
        archiveCalled = true;
        return HttpResponse.json({ data: detail({ archivedAt: '2026-06-21T00:00:00.000Z' }) });
      }),
    );

    renderEdit();
    await screen.findByText('トップページ');

    expect(screen.getByText('アーカイブ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /アーカイブする/ }));

    const alert = await screen.findByRole('alertdialog');
    await user.click(within(alert).getByRole('button', { name: 'アーカイブする' }));

    await waitFor(() => expect(archiveCalled).toBe(true));
    // アーカイブ後は一覧へ戻す。
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/projects'));
  });

  it('アーカイブ済み director では復元操作ができる (POST unarchive)', async () => {
    const user = setup();
    let unarchiveCalled = false;
    stubGets({ project: { role: 'admin', archivedAt: '2026-06-01T00:00:00.000Z' } });
    server.use(
      http.post('*/api/v1/projects/p1/unarchive', () => {
        unarchiveCalled = true;
        return HttpResponse.json({ data: detail({ archivedAt: null }) });
      }),
    );
    const { toast } = await import('sonner');

    renderEdit();
    await screen.findByText('トップページ');

    await user.click(screen.getByRole('button', { name: /復元する/ }));
    const alert = await screen.findByRole('alertdialog');
    await user.click(within(alert).getByRole('button', { name: '復元する' }));

    await waitFor(() => expect(unarchiveCalled).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('プロジェクトを復元しました'));
  });

  it('非 director ではアーカイブセクションを表示しない', async () => {
    stubGets({ project: { role: 'editor' } });
    renderEdit();

    await screen.findByText('トップページ');
    expect(screen.queryByText('アーカイブ')).not.toBeInTheDocument();
  });
});
