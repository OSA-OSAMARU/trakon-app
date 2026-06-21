import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// supabase をモックして signInWithOAuth のみ制御する。
const signInWithOAuth = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a) } },
}));

import { renderWithProviders } from '@/test/render';
import { OAuthButtons } from './OAuthButtons';

beforeEach(() => {
  signInWithOAuth.mockReset();
  signInWithOAuth.mockResolvedValue({ data: {}, error: null });
});

describe('OAuthButtons', () => {
  it('Google ボタンで signInWithOAuth(provider=google) を select_account 付きで呼ぶ', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<OAuthButtons />);

    await user.click(screen.getByRole('button', { name: /Google で続ける/ }));

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    const arg = signInWithOAuth.mock.calls[0]![0];
    expect(arg.provider).toBe('google');
    expect(arg.options.queryParams).toEqual({ prompt: 'select_account' });
    expect(arg.options.redirectTo).toContain('/auth/callback');
  });

  it('Microsoft ボタンで signInWithOAuth(provider=azure) を queryParams なしで呼ぶ', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<OAuthButtons />);

    await user.click(screen.getByRole('button', { name: /Microsoft で続ける/ }));

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    const arg = signInWithOAuth.mock.calls[0]![0];
    expect(arg.provider).toBe('azure');
    expect(arg.options.queryParams).toBeUndefined();
  });

  it('エラー時はエラーメッセージを表示しボタンを再活性化する', async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: { message: 'boom' } });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<OAuthButtons />);

    await user.click(screen.getByRole('button', { name: /Google で続ける/ }));

    expect(
      await screen.findByText(/OAuth プロバイダへの遷移に失敗しました/),
    ).toBeInTheDocument();
    // busy が解除され再度クリック可能
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Google で続ける/ })).not.toBeDisabled(),
    );
  });
});
