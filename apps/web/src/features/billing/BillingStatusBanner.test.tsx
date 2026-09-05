import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { defaultBillingResponse, server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { BillingStatusBanner } from './BillingStatusBanner';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'u-me' } } } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));

type Entitlement = typeof defaultBillingResponse.entitlement;

function stub(entitlement: Partial<Entitlement>) {
  server.use(
    http.get('*/api/v1/billing/subscription', () =>
      HttpResponse.json({
        data: {
          ...defaultBillingResponse,
          entitlement: { ...defaultBillingResponse.entitlement, ...entitlement },
        },
      }),
    ),
  );
}

// 課金起因の制限は隠さず、理由と復旧導線を必ず添える (設計書 §4.5.2)。
describe('BillingStatusBanner', () => {
  it('支払い猶予中は理由と復旧導線を出す', async () => {
    stub({
      reason: 'in_grace_period',
      message: 'お支払いを確認できませんでした。お支払い方法を更新してください。',
    });
    renderWithProviders(<BillingStatusBanner />);

    expect(await screen.findByRole('status')).toHaveTextContent('お支払いを確認できませんでした');
    expect(screen.getByRole('link', { name: 'お支払い方法を更新' })).toHaveAttribute(
      'href',
      '/settings/billing',
    );
  });

  it('閲覧のみに落ちている場合も出す', async () => {
    stub({ level: 'read_only', reason: 'grace_expired', message: '閲覧のみになっています。' });
    renderWithProviders(<BillingStatusBanner />);

    expect(await screen.findByRole('status')).toHaveTextContent('閲覧のみになっています。');
  });

  it('決済が未完了なら出す', async () => {
    stub({ reason: 'incomplete', message: 'お支払いが完了していません。' });
    renderWithProviders(<BillingStatusBanner />);

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('通常利用中は何も出さない', async () => {
    renderWithProviders(<BillingStatusBanner />);

    // 読み込み完了を待ってから、バナーが無いことを確かめる
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
