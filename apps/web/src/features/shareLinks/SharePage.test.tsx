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
  it('共有ビューを取得してヘッダ (プロジェクト名/scope/確認・承認) を描画する', async () => {
    server.use(http.get('*/api/v1/share/:token', () => HttpResponse.json({ data: view })));
    renderWithProviders(<SharePage />);

    expect(await screen.findByText('共有プロジェクト')).toBeInTheDocument();
    expect(screen.getByText('共有リンク (確認・承認)')).toBeInTheDocument();
    expect(screen.getByText('scope: project')).toBeInTheDocument();
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
