import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import type { ShareView } from './api';
import type * as ReactRouterDom from 'react-router-dom';

// supabase は SharePage 自体は使わないが、api.ts の getSession 注入経路で参照されるためモックする。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

// react-router-dom を部分モックし useParams(token) を制御する。
const params = { token: 'share-tok' as string | undefined };
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterDom>();
  return {
    ...actual,
    useParams: () => ({ token: params.token }),
  };
});

import { SharePage } from './SharePage';

// ShareSchedule (Radix Badge 等) 用の jsdom シム。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
});

const view: ShareView = {
  share: {
    id: 's1',
    scopeType: 'project',
    scopeTargetId: null,
    expiresAt: '2026-07-01T09:00:00.000Z',
  },
  project: {
    id: 'p1',
    name: '共有プロジェクト',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
  },
  items: [{ id: 'it1', name: 'LP' }],
  plans: [],
};

beforeEach(() => {
  params.token = 'share-tok';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SharePage', () => {
  it('ヘッダにプロジェクト名・期間・共有用バッジ・有効期限を出す (#256)', async () => {
    server.use(http.get('*/api/v1/share/:token', () => HttpResponse.json({ data: view })));
    renderWithProviders(<SharePage />);

    expect(await screen.findByRole('heading', { name: '共有プロジェクト' })).toBeInTheDocument();
    expect(screen.getByText('共有用')).toBeInTheDocument();
    expect(screen.getByText(/期間：2026\/06\/01 〜 2026\/06\/30/)).toBeInTheDocument();
    // 時刻はローカルタイムゾーンで出るため、書式だけを見る (CI は UTC)
    expect(screen.getByText(/^有効期限 \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}まで$/)).toBeInTheDocument();
    // プロジェクト全体の共有ではスコープの注記は出さない (既定なので情報量が増えない)
    expect(screen.queryByText(/の共有/)).toBeNull();
  });

  it('期限なしのリンクは「無期限」と出す', async () => {
    server.use(
      http.get('*/api/v1/share/:token', () =>
        HttpResponse.json({ data: { ...view, share: { ...view.share, expiresAt: null } } }),
      ),
    );
    renderWithProviders(<SharePage />);

    expect(await screen.findByText('有効期限なし（無期限）')).toBeInTheDocument();
  });

  it('制作物単位の共有ではスコープを注記する', async () => {
    server.use(
      http.get('*/api/v1/share/:token', () =>
        HttpResponse.json({
          data: { ...view, share: { ...view.share, scopeType: 'item', scopeTargetId: 'it1' } },
        }),
      ),
    );
    renderWithProviders(<SharePage />);

    expect(await screen.findByText(/特定の制作物の共有/)).toBeInTheDocument();
  });

  it('カレンダーは角丸カードに収め、画面の端に貼り付かせない (#256)', async () => {
    server.use(http.get('*/api/v1/share/:token', () => HttpResponse.json({ data: view })));
    const { container } = renderWithProviders(<SharePage />);
    await screen.findByRole('heading', { name: '共有プロジェクト' });

    // 外側: 淡色の地 + 余白 / 内側: 角丸のカード
    const canvas = container.querySelector('.bg-surface-muted')!;
    expect(canvas.className).toContain('lg:px-12');
    expect(canvas.firstElementChild!.className).toContain('rounded-2xl');
  });

  it('robots noindex meta を head に注入する', async () => {
    server.use(http.get('*/api/v1/share/:token', () => HttpResponse.json({ data: view })));
    renderWithProviders(<SharePage />);
    await screen.findByText('共有プロジェクト');

    const meta = document.head.querySelector('meta[name="robots"]');
    expect(meta?.getAttribute('content')).toBe('noindex, nofollow, noarchive');
  });

  it('取得失敗時はエラーメッセージを表示する', async () => {
    server.use(
      http.get('*/api/v1/share/:token', () =>
        HttpResponse.json(
          { error: { code: 'SHARE_LINK_NOT_FOUND', message: 'gone' } },
          { status: 404 },
        ),
      ),
    );
    renderWithProviders(<SharePage />);

    expect(
      await screen.findByText('リンクが見つからないか、期限切れです。発行者にお問い合わせください。'),
    ).toBeInTheDocument();
  });

  it('token が無い場合は「無効なリンクです。」を表示する (API は呼ばない)', () => {
    params.token = undefined;
    // ハンドラ未登録: 呼ばれたら onUnhandledRequest='error' で失敗するため、呼ばれないことの確認にもなる。
    renderWithProviders(<SharePage />);
    expect(screen.getByText('無効なリンクです。')).toBeInTheDocument();
  });
});
