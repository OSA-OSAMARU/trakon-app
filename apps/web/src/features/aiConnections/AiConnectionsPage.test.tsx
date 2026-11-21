import { beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';

import { AiConnectionsPage } from './AiConnectionsPage';
import type { AiConnection } from './api';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 't', user: { id: 'user-1' } } },
      }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
    },
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const conn = (over: Partial<AiConnection> = {}): AiConnection => ({
  id: 'g1',
  clientName: 'Claude',
  scopes: ['read', 'write'],
  createdAt: '2026-11-01T00:00:00.000Z',
  lastUsedAt: null,
  ...over,
});

function stubList(list: AiConnection[] | 'error') {
  server.use(
    http.get('*/api/v1/ai-connections', () =>
      list === 'error'
        ? HttpResponse.json({ error: { code: 'X', message: 'x' } }, { status: 500 })
        : HttpResponse.json({ data: list }),
    ),
  );
}

describe('AiConnectionsPage (SC-21)', () => {
  it('MCP サーバの URL をコピーできる', async () => {
    stubList([]);
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderWithProviders(<AiConnectionsPage />, { route: '/settings/ai' });

    const input = screen.getByLabelText('MCP サーバの URL');
    expect(input).toHaveValue(`${window.location.origin}/api/mcp`);
    await user.click(screen.getByRole('button', { name: 'URL をコピー' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/mcp`);
    expect(toastSuccess).toHaveBeenCalledWith('URL をクリップボードにコピーしました');
    expect(await screen.findByText('接続中のアプリはありません。')).toBeInTheDocument();
  });

  it('コピーに失敗したら知らせる', async () => {
    stubList([]);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    renderWithProviders(<AiConnectionsPage />, { route: '/settings/ai' });
    await user.click(screen.getByRole('button', { name: 'URL をコピー' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('コピーに失敗しました'));
  });

  it('接続中のアプリを並べ、確認のうえ解除する', async () => {
    stubList([
      conn(),
      conn({
        id: 'g2',
        clientName: 'ChatGPT',
        scopes: ['read'],
        lastUsedAt: '2026-11-20T03:00:00.000Z',
      }),
    ]);
    let deleted: string | undefined;
    server.use(
      http.delete('*/api/v1/ai-connections/:id', ({ params }) => {
        deleted = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AiConnectionsPage />, { route: '/settings/ai' });

    expect(await screen.findByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('閲覧・編集')).toBeInTheDocument();
    expect(screen.getByText('閲覧のみ')).toBeInTheDocument();
    expect(screen.getByText(/最終利用 まだありません/)).toBeInTheDocument();
    expect(screen.getByText(/最終利用 \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: '接続を解除' })[0]!);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('「Claude」の接続を解除しますか？');
    await user.click(within(dialog).getByRole('button', { name: '接続を解除' }));
    await waitFor(() => expect(deleted).toBe('g1'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('接続を解除しました'));
  });

  it('解除に失敗したら知らせる', async () => {
    stubList([conn()]);
    server.use(
      http.delete('*/api/v1/ai-connections/:id', () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<AiConnectionsPage />, { route: '/settings/ai' });
    await user.click(await screen.findByRole('button', { name: '接続を解除' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: '接続を解除' }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('接続を解除できませんでした'));
  });

  it('取得に失敗したら知らせる', async () => {
    stubList('error');
    renderWithProviders(<AiConnectionsPage />, { route: '/settings/ai' });
    expect(await screen.findByText('接続中のアプリを取得できませんでした。')).toBeInTheDocument();
  });
});
