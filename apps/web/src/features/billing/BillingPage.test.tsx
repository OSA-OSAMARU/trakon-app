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
    // Checkout からの復帰時に走る照合 (#209)。既定では GET と同じ状態を返す
    http.post('*/api/v1/billing/sync', () =>
      HttpResponse.json({ data: { ...defaultBillingResponse, ...over }, meta: { synced: false } }),
    ),
    http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
  );
}

/**
 * プラン一覧のボタンを押し、確認モーダルで確定まで進める (#235)。
 * 課金が動く操作は押した瞬間には実行されない。
 */
async function selectPlan(planCode: 'personal' | 'team', label: string) {
  const card = await screen.findByTestId(`plan-${planCode}`);
  await userEvent.click(within(card).getByRole('button', { name: label }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(
    within(dialog).getByRole('button', { name: label === '申し込む' ? '決済ページへ進む' : '変更する' }),
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
      // 利用状況タイル (Figma node 263:18)
      expect(screen.getByText('会員アカウント枠')).toBeInTheDocument();
      expect(screen.getByText('1 / 1 アカウント')).toBeInTheDocument();
      expect(screen.getByText('所有プロジェクト')).toBeInTheDocument();
      expect(screen.getByText('0 / 2 件')).toBeInTheDocument();
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

    it('契約中はプラン一覧を畳み、「プランを変更」で開く (#156)', async () => {
      stubBilling({
        subscription: { ...defaultBillingResponse.subscription, planCode: 'team', status: 'active' },
        entitlement: {
          ...defaultBillingResponse.entitlement,
          planCode: 'team',
          effectivePlanCode: 'team',
          limits: { seatLimit: 5, viewerLimit: 0, projectLimit: null },
          usage: { seatCount: 3, viewerCount: 0, projectCount: 8 },
          message: 'Team プランを利用中です。',
        },
      });
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await screen.findByText('現在のプラン');
      // 無制限は件数を出さずそのまま「無制限」と出す
      expect(screen.getByText('無制限')).toBeInTheDocument();
      expect(screen.getByText('3 / 5 アカウント')).toBeInTheDocument();
      expect(screen.queryByTestId('plan-team')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'プランを変更' }));
      expect(await screen.findByTestId('plan-team')).toBeInTheDocument();
    });

    it('Free でも「プランを変更」が押すたびに開閉する (#197)', async () => {
      // 既定 (Free) はアップグレード導線を隠さないため最初から開いている。
      // ここでボタンが何も起こさないと「反応しない」ように見えるため、
      // 押したら必ず表示が変わることを保証する。
      stubBilling();
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      expect(await screen.findByTestId('plan-team')).toBeInTheDocument();

      const toggle = screen.getByRole('button', { name: 'プラン一覧を閉じる' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await userEvent.click(toggle);
      expect(screen.queryByTestId('plan-team')).not.toBeInTheDocument();

      const reopen = screen.getByRole('button', { name: 'プランを変更' });
      expect(reopen).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(reopen);
      expect(await screen.findByTestId('plan-team')).toBeInTheDocument();
    });

    it('権限が無くてもプラン一覧は開ける (#197)', async () => {
      // 一覧の開閉は表示の切り替えでしかない。申し込みボタン側で無効化と
      // 理由の提示を行うので、見ること自体は妨げない。
      stubBilling({
        orgRole: 'member',
        subscription: { ...defaultBillingResponse.subscription, planCode: 'team', status: 'active' },
        entitlement: {
          ...defaultBillingResponse.entitlement,
          planCode: 'team',
          effectivePlanCode: 'team',
        },
      });
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await userEvent.click(await screen.findByRole('button', { name: 'プランを変更' }));
      expect(await screen.findByTestId('plan-personal')).toBeInTheDocument();
      // 申し込み側は無効のまま
      expect(screen.getByRole('button', { name: 'このプランに変更' })).toBeDisabled();
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

      await selectPlan('team', '申し込む');

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
        limits: { seatLimit: 1, viewerLimit: 0, projectLimit: 10 },
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

      // 契約中はプラン一覧が畳まれている (Figma node 263:18)
      await userEvent.click(await screen.findByRole('button', { name: 'プランを変更' }));
      await selectPlan('team', 'このプランに変更');

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

      await selectPlan('personal', 'このプランに変更');

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

      // 契約中はプラン一覧が畳まれている (Figma node 263:18)
      await userEvent.click(await screen.findByRole('button', { name: 'プランを変更' }));
      await selectPlan('team', 'このプランに変更');

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

  // ===========================================================================
  // #235: Personal → Team は「追加請求の決済成功を確認するまで昇格しない」設計。
  // その確認は Webhook 頼みだったため、Webhook が届かない環境 (Preview デプロイは
  // URL がデプロイごとに変わり登録できない) ではプラン変更が永久に反映されなかった。
  // Checkout 復帰と同じく、待っている間は Stripe へ**取りに行く**。
  // ===========================================================================
  describe('プラン変更の反映待ち (#235)', () => {
    /** Personal のまま Team への変更を待っている状態 (pendingPlanEffectiveAt は null) */
    const PENDING_TEAM = {
      ...defaultBillingResponse,
      subscription: {
        ...defaultBillingResponse.subscription,
        planCode: 'personal' as const,
        status: 'active' as const,
        hasStripeCustomer: true,
        pendingPlanCode: 'team' as const,
        pendingPlanEffectiveAt: null,
      },
      entitlement: {
        ...defaultBillingResponse.entitlement,
        planCode: 'personal' as const,
        effectivePlanCode: 'personal' as const,
        limits: { seatLimit: 1, viewerLimit: 5, projectLimit: 10 },
        message: 'Personal プランを利用中です。',
      },
    };

    /** Stripe 側で Team が成立した後 */
    const APPLIED_TEAM = {
      ...defaultBillingResponse,
      subscription: {
        ...defaultBillingResponse.subscription,
        planCode: 'team' as const,
        status: 'active' as const,
        hasStripeCustomer: true,
        pendingPlanCode: null,
        pendingPlanEffectiveAt: null,
      },
      entitlement: {
        ...defaultBillingResponse.entitlement,
        planCode: 'team' as const,
        effectivePlanCode: 'team' as const,
        limits: { seatLimit: 5, viewerLimit: 20, projectLimit: null },
        message: 'Team プランを利用中です。',
      },
    };

    it('変更を待っている状態で画面を開くと、Stripe へ照合しに行って反映される', async () => {
      // 変更を投げた直後だけでなく、**画面を開き直しても**回復すること。
      // 待機をミューテーションの結果ではなくサーバーの状態から導いている根拠。
      let applied = false;
      let syncCalls = 0;
      server.use(
        http.get('*/api/v1/billing/subscription', () => HttpResponse.json({ data: PENDING_TEAM })),
        http.post('*/api/v1/billing/sync', () => {
          syncCalls += 1;
          return HttpResponse.json({
            data: applied ? APPLIED_TEAM : PENDING_TEAM,
            meta: { synced: applied },
          });
        }),
        http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
      );
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      expect(await screen.findByText(/Team プランへの変更を確認中です/)).toBeInTheDocument();
      // 確認できるまでは Personal のまま (待っている間に権限を先出ししない)
      expect(screen.getByText('Personal プランを利用中です。')).toBeInTheDocument();

      await waitFor(() => expect(syncCalls).toBeGreaterThan(0));

      applied = true;
      await waitFor(
        () => expect(screen.getByText('Team プランを利用中です。')).toBeInTheDocument(),
        { timeout: 5000 },
      );
      expect(screen.queryByText(/変更を確認中です/)).not.toBeInTheDocument();
    });

    it('確認できないまま時間が経ったら、手動で取り直せる', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let applied = false;
      server.use(
        http.get('*/api/v1/billing/subscription', () => HttpResponse.json({ data: PENDING_TEAM })),
        http.post('*/api/v1/billing/sync', () =>
          HttpResponse.json({
            data: applied ? APPLIED_TEAM : PENDING_TEAM,
            meta: { synced: applied },
          }),
        ),
        http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
      );
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await screen.findByText(/Team プランへの変更を確認中です/);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await screen.findByText(/お支払いの確認に時間がかかっています/)).toBeInTheDocument();

      applied = true;
      vi.useRealTimers();
      await userEvent.click(screen.getByRole('button', { name: '最新の状態を取得' }));

      expect(await screen.findByText('Team プランを利用中です。')).toBeInTheDocument();
    });

    it('取り直しても変わらなければ、更新できたことにしない', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      server.use(
        http.get('*/api/v1/billing/subscription', () => HttpResponse.json({ data: PENDING_TEAM })),
        http.post('*/api/v1/billing/sync', () =>
          HttpResponse.json({ data: PENDING_TEAM, meta: { synced: false } }),
        ),
        http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
      );
      renderWithToaster();

      await screen.findByText(/Team プランへの変更を確認中です/);
      await vi.advanceTimersByTimeAsync(30_000);
      await screen.findByText(/お支払いの確認に時間がかかっています/);

      vi.useRealTimers();
      await userEvent.click(screen.getByRole('button', { name: '最新の状態を取得' }));

      expect(await screen.findByText(/まだ確認できていません/)).toBeInTheDocument();
    });

    it('次回更新時に適用されるダウングレードは待機にしない', async () => {
      // 日付が決まっていて、その日まで何も起きないのが正しい状態。
      // ここを待機にすると、更新日まで毎回 Stripe を叩き続けることになる。
      let syncCalls = 0;
      server.use(
        http.get('*/api/v1/billing/subscription', () =>
          HttpResponse.json({
            data: {
              ...defaultBillingResponse,
              subscription: {
                ...defaultBillingResponse.subscription,
                planCode: 'team',
                status: 'active',
                hasStripeCustomer: true,
                currentPeriodEnd: '2026-10-01T00:00:00.000Z',
                pendingPlanCode: 'personal',
                pendingPlanEffectiveAt: '2026-10-01T00:00:00.000Z',
              },
            },
          }),
        ),
        http.post('*/api/v1/billing/sync', () => {
          syncCalls += 1;
          return HttpResponse.json({ data: defaultBillingResponse, meta: { synced: false } });
        }),
        http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
      );
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await screen.findByText('変更予定');
      expect(screen.queryByText(/変更を確認中です/)).not.toBeInTheDocument();
      expect(syncCalls).toBe(0);
    });

    // #244: 適用予定を過ぎたということは、Stripe 側では切り替わっているはず。
    // ここを待機に含めないと、Webhook が 1 通落ちただけで
    // 「変更予定（過去の日付）」のまま永久に固まる。
    it('適用予定を過ぎても切り替わっていなければ、取りに行って反映する (#244)', async () => {
      const OVERDUE = {
        ...defaultBillingResponse,
        subscription: {
          ...defaultBillingResponse.subscription,
          planCode: 'team' as const,
          status: 'active' as const,
          hasStripeCustomer: true,
          pendingPlanCode: 'personal' as const,
          pendingPlanEffectiveAt: '2020-01-01T00:00:00.000Z',
        },
        entitlement: {
          ...defaultBillingResponse.entitlement,
          planCode: 'team' as const,
          effectivePlanCode: 'team' as const,
          limits: { seatLimit: 5, viewerLimit: 20, projectLimit: null },
          message: 'Team プランを利用中です。',
        },
      };
      const APPLIED_PERSONAL = {
        ...defaultBillingResponse,
        subscription: {
          ...defaultBillingResponse.subscription,
          planCode: 'personal' as const,
          status: 'active' as const,
          hasStripeCustomer: true,
          pendingPlanCode: null,
          pendingPlanEffectiveAt: null,
        },
        entitlement: {
          ...defaultBillingResponse.entitlement,
          planCode: 'personal' as const,
          effectivePlanCode: 'personal' as const,
          limits: { seatLimit: 1, viewerLimit: 5, projectLimit: 10 },
          message: 'Personal プランを利用中です。',
        },
      };

      let applied = false;
      let syncCalls = 0;
      server.use(
        http.get('*/api/v1/billing/subscription', () => HttpResponse.json({ data: OVERDUE })),
        http.post('*/api/v1/billing/sync', () => {
          syncCalls += 1;
          return HttpResponse.json({
            data: applied ? APPLIED_PERSONAL : OVERDUE,
            meta: { synced: applied },
          });
        }),
        http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
      );
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      expect(await screen.findByText(/Personal プランへの切り替えを反映しています/)).toBeInTheDocument();
      await waitFor(() => expect(syncCalls).toBeGreaterThan(0));

      applied = true;
      await waitFor(
        () => expect(screen.getByText('Personal プランを利用中です。')).toBeInTheDocument(),
        { timeout: 5000 },
      );
    });
  });

  // ===========================================================================
  // #235: 課金が動く操作は、押した瞬間ではなく確認してから実行する。
  // ===========================================================================
  // ===========================================================================
  // #241: 二重契約の防止。
  // 申し込みは「新しい契約を作る」操作なので、既に契約がある状態で通すと
  // 二重に請求される。最後の砦はサーバーだが、画面でも押させない。
  // ===========================================================================
  describe('二重の申し込みを防ぐ (#241)', () => {
    it('受付済みのプランは、もう一度押せない', async () => {
      stubBilling({
        subscription: {
          ...defaultBillingResponse.subscription,
          planCode: 'personal',
          status: 'active',
          hasStripeCustomer: true,
          pendingPlanCode: 'team',
          pendingPlanEffectiveAt: null,
        },
        entitlement: {
          ...defaultBillingResponse.entitlement,
          planCode: 'personal',
          effectivePlanCode: 'personal',
          limits: { seatLimit: 1, viewerLimit: 5, projectLimit: 10 },
          message: 'Personal プランを利用中です。',
        },
      });
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await userEvent.click(await screen.findByRole('button', { name: 'プランを変更' }));
      const teamCard = await screen.findByTestId('plan-team');

      expect(within(teamCard).getByText('変更を受付済み')).toBeInTheDocument();
      expect(
        within(teamCard).queryByRole('button', { name: 'このプランに変更' }),
      ).not.toBeInTheDocument();
    });

    it('サーバーに「既に契約がある」と言われたら、画面を取り直す', async () => {
      // 画面が古いまま申し込みを押した場合。契約はサーバーが守るので、
      // ここでは表示を現在値へ戻して同じ操作を繰り返させない
      let subscriptionFetches = 0;
      server.use(
        http.get('*/api/v1/billing/subscription', () => {
          subscriptionFetches += 1;
          return HttpResponse.json({ data: defaultBillingResponse });
        }),
        http.post('*/api/v1/billing/checkout-session', () =>
          HttpResponse.json(
            {
              error: {
                code: 'SUBSCRIPTION_ALREADY_ACTIVE',
                message: '既に有効な契約があります。プラン変更をご利用ください。',
              },
            },
            { status: 409 },
          ),
        ),
      );
      renderWithToaster();

      const teamCard = await screen.findByTestId('plan-team');
      await waitFor(() => expect(subscriptionFetches).toBe(1));

      await userEvent.click(within(teamCard).getByRole('button', { name: '申し込む' }));
      const dialog = await screen.findByRole('alertdialog');
      await userEvent.click(within(dialog).getByRole('button', { name: '決済ページへ進む' }));

      expect(await screen.findByText(/既に有効な契約があります/)).toBeInTheDocument();
      expect(externalRedirect).not.toHaveBeenCalled();
      // 古い表示のまま同じ操作を繰り返させない
      await waitFor(() => expect(subscriptionFetches).toBeGreaterThan(1));
    });
  });

  describe('プラン変更の確認モーダル (#235)', () => {
    const teamSubscribed = {
      subscription: {
        ...defaultBillingResponse.subscription,
        planCode: 'team' as const,
        status: 'active' as const,
        hasStripeCustomer: true,
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
      },
      entitlement: {
        ...defaultBillingResponse.entitlement,
        planCode: 'team' as const,
        effectivePlanCode: 'team' as const,
        limits: { seatLimit: 5, viewerLimit: 20, projectLimit: null },
        message: 'Team プランを利用中です。',
      },
    };

    it('押しただけでは API を呼ばず、キャンセルすれば何も起きない', async () => {
      stubBilling();
      let called = false;
      server.use(
        http.post('*/api/v1/billing/checkout-session', () => {
          called = true;
          return HttpResponse.json({ data: { url: 'https://checkout.test/s', trialApplied: true } });
        }),
      );
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      const teamCard = await screen.findByTestId('plan-team');
      await userEvent.click(within(teamCard).getByRole('button', { name: '申し込む' }));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText(/決済ページへ移動します/)).toBeInTheDocument();
      expect(called).toBe(false);

      await userEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(called).toBe(false);
      expect(externalRedirect).not.toHaveBeenCalled();
    });

    it('アップグレードは日割りの追加請求と反映時期を先に伝える', async () => {
      stubBilling({
        subscription: {
          ...defaultBillingResponse.subscription,
          planCode: 'personal',
          status: 'active',
          hasStripeCustomer: true,
        },
        entitlement: {
          ...defaultBillingResponse.entitlement,
          planCode: 'personal',
          effectivePlanCode: 'personal',
          limits: { seatLimit: 1, viewerLimit: 5, projectLimit: 10 },
          message: 'Personal プランを利用中です。',
        },
      });
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await userEvent.click(await screen.findByRole('button', { name: 'プランを変更' }));
      const teamCard = await screen.findByTestId('plan-team');
      await userEvent.click(within(teamCard).getByRole('button', { name: 'このプランに変更' }));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText(/日割りで追加請求/)).toBeInTheDocument();
      expect(within(dialog).getByText(/お支払いが確認できた後/)).toBeInTheDocument();
    });

    it('ダウングレードは切り替え日と下がる上限を先に伝える', async () => {
      stubBilling(teamSubscribed);
      renderWithProviders(<BillingPage />, { route: '/settings/billing' });

      await userEvent.click(await screen.findByRole('button', { name: 'プランを変更' }));
      const personalCard = await screen.findByTestId('plan-personal');
      await userEvent.click(within(personalCard).getByRole('button', { name: 'このプランに変更' }));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText(/2026\/10\/01/)).toBeInTheDocument();
      expect(within(dialog).getByText(/返金はありません/)).toBeInTheDocument();
      expect(within(dialog).getByText(/超えている場合は変更できません/)).toBeInTheDocument();
    });
  });

  describe('決済情報を管理', () => {
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
        await screen.findByRole('button', { name: '決済情報を管理' }),
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
        screen.queryByRole('button', { name: '決済情報を管理' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('Checkout からの復帰', () => {
    /** 照合で契約が確認できた後の状態 (Personal のトライアル中)。 */
    const ACTIVATED = {
      ...defaultBillingResponse,
      subscription: {
        ...defaultBillingResponse.subscription,
        planCode: 'personal' as const,
        status: 'trialing' as const,
        hasStripeCustomer: true,
      },
      entitlement: {
        ...defaultBillingResponse.entitlement,
        reason: 'trialing' as const,
        planCode: 'personal' as const,
        effectivePlanCode: 'personal' as const,
        limits: { seatLimit: 1, viewerLimit: 0, projectLimit: 10 },
        message: 'Personal プランの無料トライアル中です。',
      },
    };

    it('success で戻った直後は「反映待ち」を出す (この遷移だけで有効化しない)', async () => {
      stubBilling();
      renderWithProviders(<BillingPage />, {
        route: '/settings/billing?checkout=success&session_id=cs_1',
      });

      expect(await screen.findByText(/お支払いの確認中です/)).toBeInTheDocument();
    });

    it('照合で契約が確認できると有効化され、反映待ちが消える (#209)', async () => {
      // success URL への到達では有効化せず、**Stripe から取り直した契約状態**だけを
      // 根拠にする。Webhook が届かない環境でもここで止まらないことを保証する。
      let activated = false;
      const syncCalls: { checkoutSessionId?: string }[] = [];
      server.use(
        http.get('*/api/v1/billing/subscription', () =>
          HttpResponse.json({ data: defaultBillingResponse }),
        ),
        http.post('*/api/v1/billing/sync', async ({ request }) => {
          syncCalls.push((await request.json()) as { checkoutSessionId?: string });
          return HttpResponse.json({
            data: activated ? ACTIVATED : defaultBillingResponse,
            meta: { synced: activated },
          });
        }),
        http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
      );
      renderWithProviders(<BillingPage />, {
        route: '/settings/billing?checkout=success&session_id=cs_1',
      });

      // 契約が確認できるまでは Free のまま
      expect(await screen.findByText(/お支払いの確認中です/)).toBeInTheDocument();
      expect(screen.getByText('Free プランを利用中です。')).toBeInTheDocument();

      // 照合には Checkout Session ID を渡す (まだ契約 ID を持っていない組織でも辿れる)
      await waitFor(() => expect(syncCalls.length).toBeGreaterThan(0));
      expect(syncCalls[0]).toEqual({ checkoutSessionId: 'cs_1' });

      activated = true;

      await waitFor(
        () => expect(screen.getByText('Personal プランの無料トライアル中です。')).toBeInTheDocument(),
        { timeout: 5000 },
      );
      expect(screen.queryByText(/お支払いの確認中です/)).not.toBeInTheDocument();
    });

    it('照合が続いても確認できないときは手動で取り直せる (#209)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let activated = false;
      server.use(
        http.get('*/api/v1/billing/subscription', () =>
          HttpResponse.json({ data: defaultBillingResponse }),
        ),
        http.post('*/api/v1/billing/sync', () =>
          HttpResponse.json({
            data: activated ? ACTIVATED : defaultBillingResponse,
            meta: { synced: activated },
          }),
        ),
        http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
      );
      renderWithProviders(<BillingPage />, {
        route: '/settings/billing?checkout=success&session_id=cs_1',
      });

      await screen.findByText(/お支払いの確認中です/);

      // 30 秒で自動の照合は打ち切る。黙って止めず取り直す手段を残す
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await screen.findByText(/お支払いの確認に時間がかかっています/)).toBeInTheDocument();

      activated = true;
      vi.useRealTimers();
      await userEvent.click(screen.getByRole('button', { name: '最新の状態を取得' }));

      expect(
        await screen.findByText('Personal プランの無料トライアル中です。'),
      ).toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: '決済情報を管理' })).toBeEnabled();
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
      // Free は月額 0 円なので価格は出さず、上限だけを出す
      expect(screen.getByText(/会員アカウント 1人 \/ アクティブプロジェクト 2/)).toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: '決済情報を管理' })).toBeInTheDocument();
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

      await selectPlan('team', '申し込む');

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
          usage: { seatCount: 1, viewerCount: 0, projectCount: 3 },
          over: { seats: 0, viewers: 0, projects: 1 },
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
