import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';

import { navigateAway } from './api';
import { OAuthConsentPage } from './OAuthConsentPage';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 't', user: { id: 'user-1' } } },
      }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
      signOut: vi.fn(),
    },
  },
}));

const ROUTE =
  '/oauth/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&code_challenge=x&code_challenge_method=S256&state=s&unknown=1';

function stubSync() {
  server.use(
    http.post('*/api/v1/auth/me/sync', () =>
      HttpResponse.json({
        data: {
          requiresProfileCompletion: false,
          user: { displayName: '山田', email: 'yamada@example.test' },
        },
      }),
    ),
  );
}

function stubCheck(data: unknown, status = 200) {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get('*/api/v1/oauth/authorize', ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return status === 200
        ? HttpResponse.json({ data })
        : HttpResponse.json(
            { error: { code: 'OAUTH_INVALID_REQUEST', message: '登録されていません。' } },
            { status },
          );
    }),
  );
  return seen;
}

// restoreAllMocks は supabase モックの実装まで消すので、遷移の spy だけ戻す
afterEach(() => {
  if (vi.isMockFunction(navigateAway.to)) navigateAway.to.mockRestore();
});

const consent = {
  status: 'consent',
  client: { id: 'c1', name: 'Claude' },
  redirectHost: 'claude.ai',
  scopes: ['read', 'write'],
};

describe('OAuthConsentPage (SC-20)', () => {
  it('アプリ名・戻り先ホスト・できること・アカウントを示す', async () => {
    stubSync();
    const seen = stubCheck(consent);
    renderWithProviders(<OAuthConsentPage />, { route: ROUTE });

    expect(await screen.findByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('claude.ai')).toBeInTheDocument();
    expect(screen.getByText(/閲覧/)).toBeInTheDocument();
    expect(screen.getByText(/ボールの受け渡し/)).toBeInTheDocument();
    expect(await screen.findByText(/yamada@example.test/)).toBeInTheDocument();
    // OAuth のパラメータだけを API に引き継ぐ
    expect(seen[0]!.get('client_id')).toBe('c1');
    expect(seen[0]!.get('unknown')).toBeNull();
  });

  it('許可すると API が返した戻り先へ遷移する', async () => {
    stubSync();
    stubCheck(consent);
    let posted: unknown;
    server.use(
      http.post('*/api/v1/oauth/authorize', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ data: { redirectTo: 'https://claude.ai/cb?code=abc' } });
      }),
    );
    const to = vi.spyOn(navigateAway, 'to').mockImplementation(() => {});
    renderWithProviders(<OAuthConsentPage />, { route: ROUTE });

    await userEvent.click(await screen.findByRole('button', { name: '許可する' }));
    await waitFor(() => expect(to).toHaveBeenCalledWith('https://claude.ai/cb?code=abc'));
    expect(posted).toMatchObject({ approved: true, params: { client_id: 'c1', state: 's' } });
  });

  it('拒否も API 経由で戻す。失敗したらその場に表示する', async () => {
    stubSync();
    stubCheck(consent);
    server.use(
      http.post('*/api/v1/oauth/authorize', () =>
        HttpResponse.json(
          { error: { code: 'OAUTH_INVALID_REQUEST', message: '期限切れです' } },
          { status: 400 },
        ),
      ),
    );
    const to = vi.spyOn(navigateAway, 'to').mockImplementation(() => {});
    renderWithProviders(<OAuthConsentPage />, { route: ROUTE });

    await userEvent.click(await screen.findByRole('button', { name: '拒否する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('期限切れです');
    expect(to).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '拒否する' })).toBeEnabled();
  });

  it('戻り先を信用できない不備はその場でエラーにし、遷移しない', async () => {
    stubSync();
    stubCheck(null, 400);
    const to = vi.spyOn(navigateAway, 'to').mockImplementation(() => {});
    renderWithProviders(<OAuthConsentPage />, { route: ROUTE });

    expect(await screen.findByText('この接続は続けられません')).toBeInTheDocument();
    expect(screen.getByText(/登録されていません。/)).toBeInTheDocument();
    expect(to).not.toHaveBeenCalled();
  });

  it('戻り先を信用できる不備でも自動では遷移せず、押したときだけ戻す (オープンリダイレクト対策)', async () => {
    stubSync();
    stubCheck({ status: 'redirect', redirectTo: 'https://claude.ai/cb?error=invalid_scope' });
    const to = vi.spyOn(navigateAway, 'to').mockImplementation(() => {});
    renderWithProviders(<OAuthConsentPage />, { route: ROUTE });

    expect(await screen.findByText('この接続は続けられません')).toBeInTheDocument();
    expect(screen.getByText('戻り先: claude.ai')).toBeInTheDocument();
    expect(to).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'アプリに戻る' }));
    expect(to).toHaveBeenCalledWith('https://claude.ai/cb?error=invalid_scope');
  });
});
