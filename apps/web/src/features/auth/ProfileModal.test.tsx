import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

// supabase は apiRequest の Authorization 注入で getSession を呼ぶためモックする。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

// sonner の toast を捕捉する。
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { ProfileModal } from './ProfileModal';
import type { CurrentUser } from './api';

// Radix が jsdom で必要とする API のシム。
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const user: CurrentUser = {
  id: 'u1',
  email: 'me@example.com',
  fullName: '山田 太郎',
  displayName: 'たろ',
  primaryAuthMethod: 'password',
  createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe('ProfileModal', () => {
  it('open=true で view モードのプロフィール情報を描画する', () => {
    renderWithProviders(
      <ProfileModal user={user} open onClose={() => {}} onSignOut={() => {}} />,
    );
    expect(screen.getByText('アカウント')).toBeInTheDocument();
    expect(screen.getByText('me@example.com')).toBeInTheDocument();
    expect(screen.getByText('メール + パスワード')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'プロフィールを編集' })).toBeInTheDocument();
    // password 認証なのでパスワード変更ボタンが出る
    expect(screen.getByRole('button', { name: 'パスワードを変更' })).toBeInTheDocument();
  });

  it('閉じるボタンで onClose を呼ぶ', async () => {
    const onClose = vi.fn();
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(
      <ProfileModal user={user} open onClose={onClose} onSignOut={() => {}} />,
    );
    await u.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('サインアウトボタンで onSignOut を呼ぶ', async () => {
    const onSignOut = vi.fn();
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(
      <ProfileModal user={user} open onClose={() => {}} onSignOut={onSignOut} />,
    );
    await u.click(screen.getByRole('button', { name: /サインアウト/ }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('プロフィール編集 → 保存で PATCH /auth/me を送り成功トーストを出す', async () => {
    let body: unknown = null;
    server.use(
      http.patch('*/api/v1/auth/me', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { ...user, fullName: '佐藤 花子', displayName: 'はな' } });
      }),
    );

    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(
      <ProfileModal user={user} open onClose={() => {}} onSignOut={() => {}} />,
    );

    await u.click(screen.getByRole('button', { name: 'プロフィールを編集' }));
    const fullName = await screen.findByDisplayValue('山田 太郎');
    await u.clear(fullName);
    await u.type(fullName, '佐藤 花子');
    const displayName = screen.getByDisplayValue('たろ');
    await u.clear(displayName);
    await u.type(displayName, 'はな');
    await u.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('プロフィールを更新しました'),
    );
    expect(body).toEqual({ fullName: '佐藤 花子', displayName: 'はな' });
  });

  it('氏名を空にするとバリデーションエラーを出し送信しない', async () => {
    let called = false;
    server.use(
      http.patch('*/api/v1/auth/me', () => {
        called = true;
        return HttpResponse.json({ data: user });
      }),
    );

    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(
      <ProfileModal user={user} open onClose={() => {}} onSignOut={() => {}} />,
    );

    await u.click(screen.getByRole('button', { name: 'プロフィールを編集' }));
    const fullName = await screen.findByDisplayValue('山田 太郎');
    await u.clear(fullName);
    await u.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('氏名は必須')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('PATCH エラーでエラートーストを出す', async () => {
    server.use(
      http.patch('*/api/v1/auth/me', () =>
        HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: '更新できません' } },
          { status: 422 },
        ),
      ),
    );

    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(
      <ProfileModal user={user} open onClose={() => {}} onSignOut={() => {}} />,
    );

    await u.click(screen.getByRole('button', { name: 'プロフィールを編集' }));
    await screen.findByDisplayValue('山田 太郎');
    await u.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('更新できません'));
  });

  it('パスワード変更フォームで PATCH(newPassword) を送り成功トーストを出す', async () => {
    let body: { newPassword?: string } | null = null;
    server.use(
      http.patch('*/api/v1/auth/me', async ({ request }) => {
        body = (await request.json()) as { newPassword?: string };
        return HttpResponse.json({ data: user });
      }),
    );

    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(
      <ProfileModal user={user} open onClose={() => {}} onSignOut={() => {}} />,
    );

    await u.click(screen.getByRole('button', { name: 'パスワードを変更' }));
    // FormField の Label は htmlFor を持たないため type=password で 2 つの入力を取得する。
    await waitFor(() => expect(screen.getByText('新しいパスワード')).toBeInTheDocument());
    const pwInputs = document.querySelectorAll('input[type="password"]');
    expect(pwInputs).toHaveLength(2);
    await u.type(pwInputs[0] as HTMLElement, 'abcd1234!');
    await u.type(pwInputs[1] as HTMLElement, 'abcd1234!');
    // 送信ボタン (mode=password のフッターの submit) をクリックする。
    const buttons = screen.getAllByRole('button', { name: 'パスワードを変更' });
    await u.click(buttons[buttons.length - 1]!);

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('パスワードを変更しました'),
    );
    expect(body).toEqual({ newPassword: 'abcd1234!' });
  });

  it('退会する → 理由選択＋「退会」入力で DELETE /auth/me を送り onSignOut を呼ぶ', async () => {
    let body: { reason?: string } | null = null;
    server.use(
      http.delete('*/api/v1/auth/me', async ({ request }) => {
        body = (await request.json()) as { reason?: string };
        return HttpResponse.json({ data: { ok: true } });
      }),
    );

    const onSignOut = vi.fn();
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(
      <ProfileModal user={user} open onClose={() => {}} onSignOut={onSignOut} />,
    );

    await u.click(screen.getByRole('button', { name: '退会する' }));
    // 理由ラジオを1つ選ぶ
    await u.click(await screen.findByLabelText('他のツールに移行'));
    // 「退会」と入力
    await u.type(screen.getByPlaceholderText('退会'), '退会');
    // フッターの退会実行ボタン (複数ある「退会する」の最後)
    const buttons = screen.getAllByRole('button', { name: '退会する' });
    await u.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('退会が完了しました'));
    expect(body).toEqual({ reason: 'switching_tool' });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('退会フォームで理由未選択／「退会」未入力だとバリデーションエラーを出し送信しない', async () => {
    let called = false;
    server.use(
      http.delete('*/api/v1/auth/me', () => {
        called = true;
        return HttpResponse.json({ data: { ok: true } });
      }),
    );

    const onSignOut = vi.fn();
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(
      <ProfileModal user={user} open onClose={() => {}} onSignOut={onSignOut} />,
    );

    await u.click(screen.getByRole('button', { name: '退会する' }));
    const buttons = screen.getAllByRole('button', { name: '退会する' });
    await u.click(buttons[buttons.length - 1]!);

    expect(await screen.findByText('退会理由を選択してください')).toBeInTheDocument();
    expect(screen.getByText('「退会」と正しく入力してください')).toBeInTheDocument();
    expect(called).toBe(false);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('OAuth ユーザーにはパスワード変更ボタンを出さない', () => {
    renderWithProviders(
      <ProfileModal
        user={{ ...user, primaryAuthMethod: 'google' }}
        open
        onClose={() => {}}
        onSignOut={() => {}}
      />,
    );
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'パスワードを変更' }),
    ).not.toBeInTheDocument();
  });
});
