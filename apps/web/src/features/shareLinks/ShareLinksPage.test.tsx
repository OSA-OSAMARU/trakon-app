import { beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { ShareLinksPage } from './ShareLinksPage';
import type { ShareLink } from './api';

// supabase はモックして getSession を固定 (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 't', user: { id: 'user-1' } } },
      }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe() {} } },
      })),
    },
  },
}));

// Radix UI (Select / Dialog) が jsdom 未実装の API を呼ぶため shim する。
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

const link = (over: Partial<ShareLink> = {}): ShareLink => ({
  id: 'sl1',
  projectId: 'p1',
  scopeType: 'project',
  scopeTargetId: null,
  issuedByMemberId: 'm1',
  issuedAt: '2026-06-01T00:00:00.000Z',
  expiresAt: '2026-07-01T09:00:00.000Z',
  revokedAt: null,
  lastAccessedAt: null,
  status: 'active',
  ...over,
});

/** projectId=p1 の ShareLinksPage を <Routes> 配下に描画 (useParams 解決のため)。 */
function renderPage(route = '/projects/p1/share-links') {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId/share-links" element={<ShareLinksPage />} />
    </Routes>,
    { route },
  );
}

/** 共有リンク一覧 GET をスタブする。 */
function stubLinks(links: ShareLink[]) {
  server.use(
    http.get('*/api/v1/projects/p1/share-links', () =>
      HttpResponse.json({ data: links }),
    ),
  );
}

/** 制作物一覧 GET をスタブする (CreateDialog の items 用)。 */
function stubItems(items: Array<{ id: string; name: string }>) {
  server.use(
    http.get('*/api/v1/projects/p1/items', () => HttpResponse.json({ data: items })),
  );
}

describe('ShareLinksPage (integration)', () => {
  it('projectId が無い場合は何も描画しない (API も呼ばない)', () => {
    // ハンドラ未登録: 呼ばれたら onUnhandledRequest='error' で失敗するため、呼ばれないことの確認にもなる。
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/share-links" element={<ShareLinksPage />} />
      </Routes>,
      { route: '/share-links' },
    );
    // ヘッダの「共有リンク」が出ない (Inner が描画されない)。
    expect(container.querySelector('h1')).toBeNull();
  });

  it('ローディング中はスケルトンを表示する', async () => {
    let resolve!: (v: Response) => void;
    server.use(
      http.get(
        '*/api/v1/projects/p1/share-links',
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );
    stubItems([]);

    const { container } = renderPage();

    await waitFor(() => {
      // Skeleton (animate-pulse) が出ること。
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });

    resolve(HttpResponse.json({ data: [] }));
  });

  it('発行済みリンク (有効/失効/期限切れ) を scope 付きで描画する', async () => {
    stubLinks([
      link(),
      link({ id: 'sl2', status: 'revoked', scopeType: 'item', revokedAt: '2026-06-05T00:00:00.000Z' }),
      link({ id: 'sl3', status: 'expired', scopeType: 'plan', expiresAt: '2026-06-02T00:00:00.000Z' }),
    ]);
    stubItems([]);

    renderPage();

    expect(await screen.findByText('有効')).toBeInTheDocument();
    expect(screen.getByText('失効')).toBeInTheDocument();
    expect(screen.getByText('期限切れ')).toBeInTheDocument();
    // scope ラベル。
    expect(screen.getByText('scope: project')).toBeInTheDocument();
    expect(screen.getByText('scope: item')).toBeInTheDocument();
    expect(screen.getByText('scope: plan')).toBeInTheDocument();
    // 有効なリンクにのみ失効ボタンが出る (1 件)。
    expect(screen.getAllByRole('button', { name: '失効' })).toHaveLength(1);
  });

  it('無期限リンクは「期限 無期限」を表示する', async () => {
    stubLinks([link({ expiresAt: null, lastAccessedAt: '2026-06-10T03:00:00.000Z' })]);
    stubItems([]);

    renderPage();

    expect(await screen.findByText(/期限 無期限/)).toBeInTheDocument();
    // lastAccessedAt があれば最終アクセスも表示される。
    expect(screen.getByText(/最終アクセス/)).toBeInTheDocument();
  });

  it('リンクが無い場合は空メッセージを表示する', async () => {
    stubLinks([]);
    stubItems([]);

    renderPage();

    expect(
      await screen.findByText('発行済みのリンクはありません。'),
    ).toBeInTheDocument();
  });

  it('取得失敗時はリストが描画されない (空のまま)', async () => {
    server.use(
      http.get('*/api/v1/projects/p1/share-links', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );
    stubItems([]);

    renderPage();

    // エラー時は data が無いため空メッセージもリストも出ない。ヘッダは出る。
    expect(await screen.findByText('発行済みリンク')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('発行済みのリンクはありません。')).not.toBeInTheDocument();
    });
  });

  it('共有リンクを発行できる (フォーム → 送信 → POST ボディ捕捉 → 発行 URL 表示)', async () => {
    stubLinks([]);
    stubItems([{ id: 'it1', name: 'LP' }]);
    let postBody: unknown = null;
    server.use(
      http.post('*/api/v1/projects/p1/share-links', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({
          data: {
            shareLink: link({ id: 'sl9' }),
            rawToken: 'raw-tok',
            url: 'https://example.com/share/raw-tok',
          },
        });
      }),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    await screen.findByText('発行済みのリンクはありません。');
    await user.click(screen.getByRole('button', { name: /新規発行/ }));

    const dialog = await screen.findByRole('dialog');
    // 有効期限を 1日 (24h) に変更する。
    const expirySelect = within(dialog).getByText('1週間');
    await user.click(expirySelect);
    await user.click(await screen.findByRole('option', { name: '1日' }));

    await user.click(within(dialog).getByRole('button', { name: '発行' }));

    // POST が想定ボディ (scope=project, expiresInHours=24) で送られたこと。
    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      scopeType: 'project',
      scopeTargetId: undefined,
      expiresInHours: 24,
    });

    // 発行後は URL 表示ダイアログが出る。
    expect(await screen.findByText('共有リンクを発行しました')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com/share/raw-tok')).toBeInTheDocument();
  });

  it('発行 URL をクリップボードにコピーできる', async () => {
    stubLinks([]);
    stubItems([]);
    server.use(
      http.post('*/api/v1/projects/p1/share-links', () =>
        HttpResponse.json({
          data: {
            shareLink: link({ id: 'sl9' }),
            rawToken: 'raw-tok',
            url: 'https://example.com/share/raw-tok',
          },
        }),
      ),
    );

    const writeText = vi.fn().mockResolvedValue(undefined);

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    // navigator.clipboard は getter-only。userEvent.setup が独自スタブを差すため、
    // setup 後に defineProperty で上書きして writeText の呼び出しを観測する。
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderPage();

    await screen.findByText('発行済みのリンクはありません。');
    await user.click(screen.getByRole('button', { name: /新規発行/ }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '発行' }));

    // 発行 URL ダイアログが開くのを待ってからコピーボタンを押す。
    expect(await screen.findByText('共有リンクを発行しました')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /コピー/ }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://example.com/share/raw-tok'),
    );
  });

  it('発行 API がエラーを返しても発行 URL ダイアログは出ない', async () => {
    stubLinks([]);
    stubItems([]);
    server.use(
      http.post('*/api/v1/projects/p1/share-links', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'x' } },
          { status: 500 },
        ),
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    await screen.findByText('発行済みのリンクはありません。');
    await user.click(screen.getByRole('button', { name: /新規発行/ }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '発行' }));

    // 失敗時は発行 URL ダイアログが出ないことを確認。
    await waitFor(() => {
      expect(screen.queryByText('共有リンクを発行しました')).not.toBeInTheDocument();
    });
  });

  it('共有リンクを失効できる (確認 → DELETE 捕捉 → 再取得)', async () => {
    let listCallCount = 0;
    let deleteCalled = false;
    server.use(
      http.get('*/api/v1/projects/p1/share-links', () => {
        listCallCount += 1;
        // 失効後の再取得では status=revoked にする。
        const data =
          listCallCount > 1 ? [link({ status: 'revoked' })] : [link()];
        return HttpResponse.json({ data });
      }),
      http.delete('*/api/v1/projects/p1/share-links/sl1', () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    stubItems([]);

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    await screen.findByText('有効');
    await user.click(screen.getByRole('button', { name: '失効' }));

    const alert = await screen.findByRole('alertdialog');
    expect(
      within(alert).getByText('共有リンクを失効しますか？'),
    ).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: '失効' }));

    await waitFor(() => expect(deleteCalled).toBe(true));
    // 再取得後、有効バッジが消え失効バッジになる (失効ボタンも消える)。
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '失効' })).not.toBeInTheDocument(),
    );
  });
});
