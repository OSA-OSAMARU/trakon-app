import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Session } from '@supabase/supabase-js';
import type * as ReactRouterDom from 'react-router-dom';

// supabase をモックして各 auth メソッドを制御する。
// vi.mock は巻き上げられるため auth は vi.hoisted で定義する。
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));

// useNavigate を捕捉する (遷移先を検証)。
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterDom>();
  return { ...actual, useNavigate: () => navigate };
});

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { SC01LoginPage } from './SC01LoginPage';

function makeSession(id = 'u1', email = 'me@example.com'): Session {
  return {
    access_token: 'tok',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'r',
    user: { id, email },
  } as unknown as Session;
}

beforeEach(() => {
  for (const fn of Object.values(auth)) fn.mockReset();
  navigate.mockReset();
  // 既定: 未認証セッション + 購読は no-op。
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe() {} } },
  });
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});

describe('SC01LoginPage — login 画面', () => {
  it('既定で TRAKON 見出しとログインフォームを描画する', async () => {
    renderWithProviders(<SC01LoginPage />, { route: '/login' });
    expect(screen.getByText('TRAKON')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument();
    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
  });

  it('メール+パスワードのサインイン成功で signInWithPassword を呼び /dashboard へ遷移する', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login' });

    await user.type(screen.getByLabelText('メールアドレス'), 'me@example.com');
    await user.type(screen.getByLabelText('パスワード'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'me@example.com',
        password: 'secret123',
      }),
    );
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('サインインエラーで汎用エラーメッセージを表示し遷移しない', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'invalid' } });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login' });

    await user.type(screen.getByLabelText('メールアドレス'), 'me@example.com');
    await user.type(screen.getByLabelText('パスワード'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    expect(
      await screen.findByText('メールアドレスまたはパスワードが正しくありません。'),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('空入力で送信するとメール/パスワードのバリデーションエラーを表示する', async () => {
    // 注: input[type=email] の HTML5 制約は不正形式の送信自体をブロックするため、
    // zod のメール必須検証は「空 (HTML5 上は valid)」で送信して観測する。
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login' });

    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    expect(
      await screen.findByText('正しいメールアドレスを入力してください'),
    ).toBeInTheDocument();
    expect(screen.getByText('パスワードを入力してください')).toBeInTheDocument();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('「ログイン状態を保存する」チェックボックスを切り替えられる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login' });
    const cb = screen.getByRole('checkbox');
    expect(cb).toBeChecked();
    await user.click(cb);
    expect(cb).not.toBeChecked();
  });

  it('OAuth ボタン下に「みなし同意」文言と規約リンクを表示する', async () => {
    renderWithProviders(<SC01LoginPage />, { route: '/login' });
    expect(
      await screen.findByText(/同意したものとみなされます/),
    ).toBeInTheDocument();
    // みなし同意文言内の利用規約リンクが /terms を指す。
    const termsLinks = screen
      .getAllByRole('link', { name: '利用規約' })
      .filter((a) => a.getAttribute('href') === '/terms');
    expect(termsLinks.length).toBeGreaterThan(0);
  });

  it('認証済みかつ create-account 以外なら /dashboard へリダイレクトする', async () => {
    auth.getSession.mockResolvedValue({ data: { session: makeSession() } });
    renderWithProviders(<SC01LoginPage />, { route: '/login' });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true }),
    );
  });
});

describe('SC01LoginPage — signup 画面', () => {
  it('Magic-link 送信成功で signInWithOtp を呼び email-sent 画面へ遷移する', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=signup' });

    expect(await screen.findByRole('button', { name: /認証メールを送る/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('メールアドレス'), 'new@example.com');
    await user.click(screen.getByRole('checkbox')); // 規約同意
    await user.click(screen.getByRole('button', { name: /認証メールを送る/ }));

    await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalledTimes(1));
    expect(auth.signInWithOtp.mock.calls[0]![0].email).toBe('new@example.com');
    // email-sent 画面に遷移して送信完了表示
    expect(await screen.findByText('メールを送信しました')).toBeInTheDocument();
  });

  it('Magic-link 送信失敗でエラーメッセージを表示する', async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: { message: 'rate' } });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=signup' });

    await user.type(screen.getByLabelText('メールアドレス'), 'new@example.com');
    await user.click(screen.getByRole('checkbox')); // 規約同意
    await user.click(screen.getByRole('button', { name: /認証メールを送る/ }));

    expect(await screen.findByText(/メールの送信に失敗しました/)).toBeInTheDocument();
  });

  it('規約未同意ではメール送信ボタンのみ無効、OAuth はみなし同意で常時有効', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=signup' });

    await user.type(
      await screen.findByLabelText('メールアドレス'),
      'new@example.com',
    );
    // 未チェックではメール送信ボタンは無効。OAuth は「みなし同意」文言で担保するため常時有効。
    expect(screen.getByRole('button', { name: /認証メールを送る/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Google で続ける/ })).toBeEnabled();

    // チェックするとメール送信ボタンも解放される。
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /認証メールを送る/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Google で続ける/ })).toBeEnabled();
  });

  it('「既にアカウントをお持ちの方」でログイン画面へ戻る', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=signup' });
    await user.click(await screen.findByRole('button', { name: '既にアカウントをお持ちの方' }));
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument();
  });
});

describe('SC01LoginPage — email-sent 画面', () => {
  it('クールダウン中は再送ボタンが無効、宛先メールを表示する', async () => {
    renderWithProviders(<SC01LoginPage />, {
      route: '/login?screen=email-sent&email=sent@example.com',
    });
    expect(await screen.findByText('sent@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /再送/ })).toBeDisabled();
  });
});

describe('SC01LoginPage — password-reset-request 画面', () => {
  it('送信でリセットメールを要求し成功文言を表示する', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=password-reset-request' });

    await user.type(await screen.findByLabelText('メールアドレス'), 'reset@example.com');
    await user.click(screen.getByRole('button', { name: 'リセットメールを送る' }));

    await waitFor(() =>
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'reset@example.com',
        expect.objectContaining({ redirectTo: expect.stringContaining('/auth/callback') }),
      ),
    );
    expect(
      await screen.findByText(/入力されたメールアドレスが登録されていれば/),
    ).toBeInTheDocument();
  });

  it('プロバイダエラーでも機密保持のため成功文言に統一する', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: { message: 'x' } });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=password-reset-request' });

    await user.type(await screen.findByLabelText('メールアドレス'), 'reset@example.com');
    await user.click(screen.getByRole('button', { name: 'リセットメールを送る' }));

    expect(
      await screen.findByText(/入力されたメールアドレスが登録されていれば/),
    ).toBeInTheDocument();
  });
});

describe('SC01LoginPage — create-account 画面', () => {
  const session = makeSession('u9', 'newbie@example.com');

  it('セッションなしなら「セッションが見つかりません」を表示する', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=create-account' });
    expect(await screen.findByText('セッションが見つかりません')).toBeInTheDocument();
  });

  it('セッションありでプロフィール登録フォームを描画し、送信成功で /dashboard へ遷移する', async () => {
    auth.getSession.mockResolvedValue({ data: { session } });
    server.use(
      http.post('*/api/v1/auth/me/complete-signup', () =>
        HttpResponse.json({
          data: {
            id: 'u9',
            email: 'newbie@example.com',
            fullName: '新規 太郎',
            displayName: 'たろ',
            primaryAuthMethod: 'password',
            createdAt: '2026-01-01T00:00:00Z',
          },
        }),
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=create-account' });

    expect(await screen.findByText('newbie@example.com')).toBeInTheDocument();
    await user.type(screen.getByLabelText('氏名'), '新規 太郎');
    await user.type(screen.getByLabelText('表示名'), 'たろ');
    await user.type(screen.getByLabelText('パスワード'), 'abcd1234!');
    await user.type(screen.getByLabelText('パスワード（確認）'), 'abcd1234!');
    await user.click(screen.getByRole('button', { name: '登録' }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true }),
    );
  });

  it('パスワード不一致でバリデーションエラーを表示する', async () => {
    auth.getSession.mockResolvedValue({ data: { session } });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=create-account' });

    await screen.findByText('newbie@example.com');
    await user.type(screen.getByLabelText('氏名'), '新規 太郎');
    await user.type(screen.getByLabelText('表示名'), 'たろ');
    await user.type(screen.getByLabelText('パスワード'), 'abcd1234!');
    await user.type(screen.getByLabelText('パスワード（確認）'), 'different9!');
    await user.click(screen.getByRole('button', { name: '登録' }));

    expect(await screen.findByText('パスワードが一致しません')).toBeInTheDocument();
  });

  it('登録 API エラーでサーバーエラーメッセージを表示する', async () => {
    auth.getSession.mockResolvedValue({ data: { session } });
    server.use(
      http.post('*/api/v1/auth/me/complete-signup', () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: '登録に失敗しました' } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=create-account' });

    await screen.findByText('newbie@example.com');
    await user.type(screen.getByLabelText('氏名'), '新規 太郎');
    await user.type(screen.getByLabelText('表示名'), 'たろ');
    await user.type(screen.getByLabelText('パスワード'), 'abcd1234!');
    await user.type(screen.getByLabelText('パスワード（確認）'), 'abcd1234!');
    await user.click(screen.getByRole('button', { name: '登録' }));

    expect(await screen.findByText('登録に失敗しました')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('SAME_EMAIL_DIFFERENT_PROVIDER エラーで登録済みプロバイダを案内する', async () => {
    auth.getSession.mockResolvedValue({ data: { session } });
    server.use(
      http.post('*/api/v1/auth/me/complete-signup', () =>
        HttpResponse.json(
          {
            error: {
              code: 'SAME_EMAIL_DIFFERENT_PROVIDER',
              message: 'x',
              details: { primaryAuthMethod: 'google' },
            },
          },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<SC01LoginPage />, { route: '/login?screen=create-account' });

    await screen.findByText('newbie@example.com');
    await user.type(screen.getByLabelText('氏名'), '新規 太郎');
    await user.type(screen.getByLabelText('表示名'), 'たろ');
    await user.type(screen.getByLabelText('パスワード'), 'abcd1234!');
    await user.type(screen.getByLabelText('パスワード（確認）'), 'abcd1234!');
    await user.click(screen.getByRole('button', { name: '登録' }));

    expect(
      await screen.findByText('このメールアドレスは Google で登録済みです。'),
    ).toBeInTheDocument();
  });
});
