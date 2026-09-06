import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Toaster } from '@/components/ui/sonner';
import { defaultBillingResponse, server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { BillingPage } from './BillingPage';

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

// 外部サイト (Stripe) への遷移は jsdom で追えないのでラッパをモックする
const externalRedirect = vi.fn();
vi.mock('@/lib/navigate', () => ({
  externalRedirect: (url: string) => externalRedirect(url),
}));

beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
});

afterEach(() => vi.clearAllMocks());

type Billing = typeof defaultBillingResponse;

function stubBilling(over: Partial<Billing> = {}) {
  server.use(
    http.get('*/api/v1/billing/subscription', () =>
      HttpResponse.json({ data: { ...defaultBillingResponse, ...over } }),
    ),
    http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
  );
}

/** トースト本文を確かめるケースは Toaster も一緒に描画する (本番は App 直下にある)。 */
function renderWithToaster(route = '/settings/billing') {
  return renderWithProviders(
    <>
      <BillingPage />
      <Toaster />
    </>,
    { route },
  );
}

describe('BillingPage (integration)', () => {
  describe('表示', () => {
    it('現在のプランと利用状況を表示する', async () => {
      stubBilling();
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      expect(await screen.findByText('現在のプラン')).toBeInTheDocument();
      expect(screen.getByText('Free プランを利用中です。')).toBeInTheDocument();
      expect(screen.getByText('0 / 2')).toBeInTheDocument();
    });

    it('プラン比較に Free / Personal / Team を出す', async () => {
      stubBilling();
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await screen.findByText('プランを選ぶ');
      expect(screen.getByTestId('plan-free')).toBeInTheDocument();
      expect(screen.getByTestId('plan-personal')).toBeInTheDocument();
      expect(screen.getByTestId('plan-team')).toBeInTheDocument();
      expect(screen.getByText('9,800')).toBeInTheDocument();
    });

    it('組織メンバー (非管理者) には変更操作を無効化し理由を出す', async () => {
      stubBilling({ orgRole: 'member' });
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      expect(
        await screen.findByText(/プランの変更・解約は組織のオーナーまたは管理者のみ/),
      ).toBeInTheDocument();
      const buttons = screen.getAllByRole('button', { name: '申し込む' });
      for (const b of buttons) expect(b).toBeDisabled();
    });
  });

  describe('申し込み', () => {
    it('プランを選ぶと Checkout の URL へ遷移する', async () => {
      stubBilling();
      server.use(
        http.post('*/api/v1/billing/checkout-session', () =>
          HttpResponse.json({ data: { url: 'https://checkout.test/session', trialApplied: true } }),
        ),
      );
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      const teamCard = await screen.findByTestId('plan-team');
      await userEvent.click(within(teamCard).getByRole('button', { name: '申し込む' }));

      await waitFor(() =>
        expect(externalRedirect).toHaveBeenCalledWith('https://checkout.test/session'),
      );
    });
  });

  describe('プラン変更', () => {
    const subscribed = {
      subscription: {
        ...defaultBillingResponse.subscription,
        planCode: 'personal' as const,
        status: 'active' as const,
        hasStripeCustomer: true,
      },
      entitlement: {
        ...defaultBillingResponse.entitlement,
        planCode: 'personal' as const,
        effectivePlanCode: 'personal' as const,
        limits: { seatLimit: 1, projectLimit: 10 },
        message: 'Personal プランを利用中です。',
      },
    };

    it('契約中はボタンが「このプランに変更」になり、Checkout ではなく変更 API を呼ぶ', async () => {
      stubBilling(subscribed);
      let changedTo: unknown = null;
      server.use(
        http.post('*/api/v1/billing/plan', async ({ request }) => {
          changedTo = await request.json();
          return HttpResponse.json({ data: { appliedImmediately: false, pendingPlanCode: 'team' } });
        }),
      );
      renderWithToaster();

      const teamCard = await screen.findByTestId('plan-team');
      await userEvent.click(within(teamCard).getByRole('button', { name: 'このプランに変更' }));

      await waitFor(() => expect(changedTo).toEqual({ planCode: 'team' }));
      // 決済の確認まで反映されないことを伝える
      expect(await screen.findByText(/お支払いの確認後に反映されます/)).toBeInTheDocument();
      expect(externalRedirect).not.toHaveBeenCalled();
    });

    it('Personal への変更は次回更新時であることを伝える', async () => {
      stubBilling({
        subscription: {
          ...defaultBillingResponse.subscription,
          planCode: 'team',
          status: 'active',
          hasStripeCustomer: true,
        },
      });
      server.use(
        http.post('*/api/v1/billing/plan', () =>
          HttpResponse.json({
            data: { appliedImmediately: false, pendingPlanCode: 'personal' },
          }),
        ),
      );
      renderWithToaster();

      const personalCard = await screen.findByTestId('plan-personal');
      await userEvent.click(within(personalCard).getByRole('button', { name: 'このプランに変更' }));

      expect(await screen.findByText(/次回更新時に Personal/)).toBeInTheDocument();
    });

    it('上限超過で変更できない場合は理由を出す', async () => {
      stubBilling(subscribed);
      server.use(
        http.post('*/api/v1/billing/plan', () =>
          HttpResponse.json(
            {
              error: {
                code: 'PLAN_DOWNGRADE_BLOCKED',
                message: 'Personal プランの上限を超えているため変更できません。',
              },
            },
            { status: 409 },
          ),
        ),
      );
      renderWithToaster();

      const teamCard = await screen.findByTestId('plan-team');
      await userEvent.click(within(teamCard).getByRole('button', { name: 'このプランに変更' }));

      expect(await screen.findByText(/上限を超えているため変更できません/)).toBeInTheDocument();
    });

    it('変更予定と支払い方法を表示する', async () => {
      stubBilling({
        subscription: {
          ...defaultBillingResponse.subscription,
          planCode: 'team',
          status: 'active',
          hasStripeCustomer: true,
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
          pendingPlanCode: 'personal',
          pendingPlanEffectiveAt: '2026-10-01T00:00:00.000Z',
          paymentMethod: { brand: 'visa', last4: '4242' },
        },
      });
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      expect(await screen.findByText('変更予定')).toBeInTheDocument();
      expect(screen.getByText(/visa •••• 4242/)).toBeInTheDocument();
      expect(screen.getByText('次回更新')).toBeInTheDocument();
    });
  });

  describe('お支払い方法・請求書', () => {
    it('Customer Portal の URL へ遷移する', async () => {
      stubBilling({
        subscription: {
          ...defaultBillingResponse.subscription,
          planCode: 'team',
          status: 'active',
          hasStripeCustomer: true,
        },
      });
      server.use(
        http.post('*/api/v1/billing/portal-session', () =>
          HttpResponse.json({ data: { url: 'https://portal.test/ps' } }),
        ),
      );
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await userEvent.click(
        await screen.findByRole('button', { name: 'お支払い方法・請求書' }),
      );

      await waitFor(() =>
        expect(externalRedirect).toHaveBeenCalledWith('https://portal.test/ps'),
      );
    });

    it('顧客が未登録なら導線を出さない', async () => {
      stubBilling();
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await screen.findByText('現在のプラン');
      expect(
        screen.queryByRole('button', { name: 'お支払い方法・請求書' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('Checkout からの復帰', () => {
    it('success で戻った直後は「反映待ち」を出す (この遷移だけで有効化しない)', async () => {
      stubBilling();
      renderWithProviders(<BillingPage />, {
        route: '/settings/billing?checkout=success&session_id=cs_1',
      });

      expect(await screen.findByText(/お支払いの確認中です/)).toBeInTheDocument();
    });

    it('canceled で戻ると未完了の案内を出す', async () => {
      stubBilling();
      renderWithProviders(<BillingPage />, { route: '/settings/billing?checkout=canceled' });

      expect(await screen.findByText(/お申し込みは完了していません/)).toBeInTheDocument();
    });
  });

  describe('支払い失敗', () => {
    it('猶予期限と復旧導線を出す', async () => {
      stubBilling({
        subscription: {
          ...defaultBillingResponse.subscription,
          planCode: 'team',
          status: 'past_due',
          hasStripeCustomer: true,
        },
        entitlement: {
          ...defaultBillingResponse.entitlement,
          reason: 'in_grace_period',
          planCode: 'team',
          effectivePlanCode: 'team',
          graceEndsAt: '2026-09-08T00:00:00.000Z',
          message: 'お支払いを確認できませんでした。お支払い方法を更新してください。',
        },
      });
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      expect(
        await screen.findByText(/までにお支払い方法を更新してください/),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'お支払い方法・請求書' })).toBeEnabled();
    });
  });

  describe('解約済み（実効 Free に落ちた状態）', () => {
    // 契約プランを出したままにすると「Team なのに Free の上限」という
    // 矛盾した表示になり、同じプランへ申し込み直すこともできなくなる
    const canceled = {
      subscription: {
        ...defaultBillingResponse.subscription,
        planCode: 'team' as const,
        status: 'canceled' as const,
        hasStripeCustomer: true,
        currentPeriodEnd: '2026-09-11T11:05:00.000Z',
        trialEnd: '2026-09-11T11:05:00.000Z',
      },
      entitlement: {
        ...defaultBillingResponse.entitlement,
        reason: 'canceled' as const,
        planCode: 'team' as const,
        effectivePlanCode: 'free' as const,
      },
    };

    it('現在のプランは契約プランではなく実効プランを出す', async () => {
      stubBilling(canceled);
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await screen.findByText('現在のプラン');
      expect(screen.getByText('0 円 (税込)')).toBeInTheDocument();
      expect(screen.queryByText('9,800 円 (税込)')).not.toBeInTheDocument();
    });

    it('同じプランへ申し込み直せる', async () => {
      stubBilling(canceled);
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      const teamCard = await screen.findByTestId('plan-team');
      expect(within(teamCard).getByRole('button', { name: '申し込む' })).toBeEnabled();
      expect(within(teamCard).queryByText('利用中')).not.toBeInTheDocument();
      // 「利用中」は実効プランの Free 側に付く
      expect(within(screen.getByTestId('plan-free')).getByText('利用中')).toBeInTheDocument();
    });

    it('解約ボタンを出さない（押しても対象が無い）', async () => {
      stubBilling(canceled);
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await screen.findByText('現在のプラン');
      expect(screen.queryByRole('button', { name: '解約する' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '解約を取り消す' })).not.toBeInTheDocument();
      // 過去の請求書は見られるので支払い管理の導線は残す
      expect(screen.getByRole('button', { name: 'お支払い方法・請求書' })).toBeInTheDocument();
    });

    it('終了した契約の日付を出さない', async () => {
      stubBilling(canceled);
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await screen.findByText('現在のプラン');
      expect(screen.queryByText('次回更新')).not.toBeInTheDocument();
      expect(screen.queryByText('トライアル終了')).not.toBeInTheDocument();
    });

    it('申し込みは Checkout へ向かう（プラン変更ではない）', async () => {
      stubBilling(canceled);
      let checkoutCalled = false;
      server.use(
        http.post('*/api/v1/billing/checkout-session', () => {
          checkoutCalled = true;
          return HttpResponse.json({ data: { url: 'https://checkout.test/s', trialApplied: false } });
        }),
      );
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      const teamCard = await screen.findByTestId('plan-team');
      await userEvent.click(within(teamCard).getByRole('button', { name: '申し込む' }));

      await waitFor(() => expect(checkoutCalled).toBe(true));
    });
  });

  describe('解約', () => {
    it('契約中なら解約ボタンを出す', async () => {
      stubBilling({
        subscription: {
          ...defaultBillingResponse.subscription,
          planCode: 'team',
          status: 'active',
          hasStripeCustomer: true,
        },
      });
      let canceled = false;
      server.use(
        http.post('*/api/v1/billing/cancel', () => {
          canceled = true;
          return HttpResponse.json({ data: { cancelAtPeriodEnd: true, currentPeriodEnd: null } });
        }),
      );
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await userEvent.click(await screen.findByRole('button', { name: '解約する' }));

      await waitFor(() => expect(canceled).toBe(true));
    });

    it('解約予定なら取り消しボタンを出す', async () => {
      stubBilling({
        subscription: {
          ...defaultBillingResponse.subscription,
          planCode: 'team',
          status: 'active',
          cancelAtPeriodEnd: true,
          hasStripeCustomer: true,
        },
      });
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      expect(await screen.findByRole('button', { name: '解約を取り消す' })).toBeInTheDocument();
    });
  });

  describe('上限超過と凍結', () => {
    it('凍結中のプロジェクトがあれば維持対象を選び直せる', async () => {
      stubBilling({
        entitlement: {
          ...defaultBillingResponse.entitlement,
          usage: { seatCount: 1, projectCount: 3 },
          over: { seats: 0, projects: 1 },
          canCreateProject: false,
          message: 'Free プランの上限を超えているため、1 件のプロジェクトが閲覧のみになっています。',
        },
        frozenProjectIds: ['p3'],
      });
      server.use(
        http.get('*/api/v1/projects', () =>
          HttpResponse.json({
            data: ['p1', 'p2', 'p3'].map((id, i) => ({
              id,
              name: `プロジェクト${i + 1}`,
              clientName: null,
              startDate: '2026-01-01',
              endDate: '2026-12-31',
              status: 'active',
              archivedAt: null,
              role: 'admin',
              createdBy: 'u-me',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              progressManager: null,
              overdueCount: 0,
            })),
          }),
        ),
      );
      let posted: unknown = null;
      server.use(
        http.post('*/api/v1/organizations/me/retained-projects', async ({ request }) => {
          posted = await request.json();
          return HttpResponse.json({ data: { retainedIds: [], frozenIds: [] } });
        }),
      );
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      expect(await screen.findByText('維持するプロジェクトを選ぶ')).toBeInTheDocument();
      // 凍結中の 1 件にはバッジが付く (プロジェクト一覧の読み込みを待つ)
      expect(await screen.findByText('閲覧のみ')).toBeInTheDocument();

      // 凍結中の p3 を選び、p1 を外す
      await userEvent.click(screen.getByLabelText(/プロジェクト3/));
      await userEvent.click(screen.getByLabelText(/プロジェクト1/));
      await userEvent.click(screen.getByRole('button', { name: 'この構成で維持する' }));

      await waitFor(() => expect(posted).toEqual({ projectIds: ['p2', 'p3'] }));
    });
  });
});
