import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// supabase は apiRequest の Authorization 注入で getSession を呼ぶためモックする。
// 退会成功時の signOut({ scope: 'local' }) とメール変更の updateUser も捕捉する。
const { getSessionMock, signOutMock, updateUserMock } = vi.hoisted(() => ({
  getSessionMock: vi
    .fn()
    .mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'u1' } } } }),
  signOutMock: vi.fn().mockResolvedValue({ error: null }),
  updateUserMock: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
      signOut: signOutMock,
      updateUser: updateUserMock,
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

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { MyPage } from './MyPage';
import type { CurrentUser, SyncResponse } from '@/features/auth/api';

// Radix (Select / Dialog) が jsdom で必要とする API のシム。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
  p.setPointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const baseUser: CurrentUser = {
  id: 'u1',
  email: 'me@example.com',
  fullName: '山田 太郎',
  displayName: 'たろ',
  organizationName: null,
  jobTitle: null,
  notificationEmail: null,
  effectiveNotificationEmail: 'me@example.com',
  avatarPath: null,
  primaryAuthMethod: 'password',
  createdAt: '2026-01-01T00:00:00Z',
};

function stubSync(over: Partial<CurrentUser> = {}) {
  const body: SyncResponse = {
    requiresProfileCompletion: false,
    user: { ...baseUser, ...over },
  };
  server.use(http.post('*/api/v1/auth/me/sync', () => HttpResponse.json({ data: body })));
}

function renderPage() {
  // renderWithProviders が MemoryRouter を内包している
  return renderWithProviders(<MyPage />, { route: '/settings/profile' });
}

/** name 属性で input を取得 (Label は htmlFor 紐付けを持たないため)。 */
function inputByName(name: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!el) throw new Error(`input[name="${name}"] が見つかりません`);
  return el;
}

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  updateUserMock.mockClear();
  updateUserMock.mockResolvedValue({ data: { user: {} }, error: null });
});

describe('MyPage', () => {
  it('プロフィールとログイン情報を描画する', async () => {
    stubSync({ organizationName: '株式会社サンプル', jobTitle: 'director' });
    renderPage();

    await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));
    expect(inputByName('displayName').value).toBe('たろ');
    expect(inputByName('organizationName').value).toBe('株式会社サンプル');
    expect(screen.getByRole('combobox')).toHaveTextContent('ディレクター');
    // ログイン情報カードにログインメールが出る
    expect(screen.getAllByText('me@example.com').length).toBeGreaterThan(0);
  });

  it('通知先メール未設定ならログインメールをプレースホルダに出す', async () => {
    stubSync();
    renderPage();

    await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));
    expect(inputByName('notificationEmail').value).toBe('');
    expect(inputByName('notificationEmail')).toHaveAttribute('placeholder', 'me@example.com');
  });

  it('所属名・通知先メールを編集して保存すると PATCH /auth/me を送る', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubSync();
    let body: Record<string, unknown> | null = null;
    server.use(
      http.patch('*/api/v1/auth/me', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { ...baseUser, organizationName: 'おさまる' } });
      }),
    );

    renderPage();
    await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

    await user.type(inputByName('organizationName'), 'おさまるカンパニー');
    await user.type(inputByName('notificationEmail'), 'notify@example.com');
    await user.click(screen.getByRole('button', { name: '変更を保存' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('プロフィールを更新しました'));
    expect(body).toMatchObject({
      organizationName: 'おさまるカンパニー',
      notificationEmail: 'notify@example.com',
    });
  });

  it('職種を未設定に戻すと jobTitle: null を送る', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubSync({ jobTitle: 'director' });
    let body: Record<string, unknown> | null = null;
    server.use(
      http.patch('*/api/v1/auth/me', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: baseUser });
      }),
    );

    renderPage();
    await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: '未設定' }));
    await user.click(screen.getByRole('button', { name: '変更を保存' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(body).toMatchObject({ jobTitle: null });
  });

  it('名前を空にするとバリデーションエラーを出し送信しない', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubSync();
    const patch = vi.fn();
    server.use(
      http.patch('*/api/v1/auth/me', () => {
        patch();
        return HttpResponse.json({ data: baseUser });
      }),
    );

    renderPage();
    await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

    await user.clear(inputByName('fullName'));
    await user.click(screen.getByRole('button', { name: '変更を保存' }));

    expect(await screen.findByText('名前は必須')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('不正な通知先メールはバリデーションエラーを出す', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubSync();
    renderPage();
    await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

    await user.type(inputByName('notificationEmail'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: '変更を保存' }));

    expect(
      await screen.findByText('メールアドレスの形式が正しくありません'),
    ).toBeInTheDocument();
  });

  it('PATCH エラーでエラートーストを出す', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubSync();
    server.use(
      http.patch('*/api/v1/auth/me', () =>
        HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: '更新に失敗' } },
          { status: 422 },
        ),
      ),
    );

    renderPage();
    await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

    await user.type(inputByName('displayName'), 'X');
    await user.click(screen.getByRole('button', { name: '変更を保存' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('更新に失敗'));
  });

  describe('ログイン情報ダイアログ', () => {
    it('メールアドレス変更で supabase.updateUser を呼ぶ', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      stubSync();
      renderPage();
      await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

      await user.click(screen.getByRole('button', { name: 'ログイン情報を変更' }));
      await user.click(await screen.findByRole('button', { name: 'メールアドレスを変更' }));
      await user.type(screen.getByPlaceholderText('new@example.com'), 'new@example.com');
      await user.click(screen.getByRole('button', { name: '確認メールを送信' }));

      await waitFor(() =>
        expect(updateUserMock).toHaveBeenCalledWith(
          { email: 'new@example.com' },
          expect.objectContaining({ emailRedirectTo: expect.stringContaining('/auth/callback') }),
        ),
      );
    });

    it('現在と同じメールアドレスはバリデーションエラーで supabase を呼ばない', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      stubSync();
      renderPage();
      await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

      await user.click(screen.getByRole('button', { name: 'ログイン情報を変更' }));
      await user.click(await screen.findByRole('button', { name: 'メールアドレスを変更' }));
      await user.type(screen.getByPlaceholderText('new@example.com'), 'me@example.com');
      await user.click(screen.getByRole('button', { name: '確認メールを送信' }));

      expect(await screen.findByText('現在のメールアドレスと同じです')).toBeInTheDocument();
      expect(updateUserMock).not.toHaveBeenCalled();
    });

    it('パスワード変更で PATCH(newPassword) を送る', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      stubSync();
      let body: Record<string, unknown> | null = null;
      server.use(
        http.patch('*/api/v1/auth/me', async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ data: baseUser });
        }),
      );

      renderPage();
      await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

      await user.click(screen.getByRole('button', { name: 'ログイン情報を変更' }));
      await user.click(await screen.findByRole('button', { name: 'パスワードを変更' }));
      await user.type(inputByName('newPassword'), 'Passw0rd!');
      await user.type(inputByName('confirm'), 'Passw0rd!');
      await user.click(screen.getByRole('button', { name: 'パスワードを変更' }));

      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('パスワードを変更しました'));
      expect(body).toEqual({ newPassword: 'Passw0rd!' });
    });

    it('OAuth ユーザーにはメール / パスワードの変更ボタンを出さない', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      stubSync({ primaryAuthMethod: 'google' });
      renderPage();
      await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

      await user.click(screen.getByRole('button', { name: 'ログイン情報を変更' }));

      expect(await screen.findByText(/Google でログインしています。/)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'メールアドレスを変更' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'パスワードを変更' })).not.toBeInTheDocument();
    });
  });

  describe('退会', () => {
    it('理由選択＋「退会」入力で DELETE /auth/me を送り local signOut する', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      stubSync();
      let called = false;
      server.use(
        http.delete('*/api/v1/auth/me', () => {
          called = true;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      renderPage();
      await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

      await user.click(screen.getByRole('button', { name: '退会する' }));
      const radios = await screen.findAllByRole('radio');
      await user.click(radios[0]!);
      await user.type(screen.getByPlaceholderText('退会'), '退会');
      // ダイアログ内の送信ボタン (トリガーと同名なので後ろの方を押す)
      const buttons = screen.getAllByRole('button', { name: '退会する' });
      await user.click(buttons[buttons.length - 1]!);

      await waitFor(() => expect(called).toBe(true));
      expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('理由未選択／「退会」未入力ならバリデーションエラーで送信しない', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      stubSync();
      const del = vi.fn();
      server.use(
        http.delete('*/api/v1/auth/me', () => {
          del();
          return new HttpResponse(null, { status: 204 });
        }),
      );

      renderPage();
      await waitFor(() => expect(inputByName('fullName').value).toBe('山田 太郎'));

      await user.click(screen.getByRole('button', { name: '退会する' }));
      const buttons = await screen.findAllByRole('button', { name: '退会する' });
      await user.click(buttons[buttons.length - 1]!);

      expect(await screen.findByText('退会理由を選択してください')).toBeInTheDocument();
      expect(del).not.toHaveBeenCalled();
    });
  });
});
