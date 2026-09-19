import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';

import { AdminPage } from './AdminPage';
import type { PlatformMetrics } from './api';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }),
    },
  },
}));

const METRICS: PlatformMetrics = {
  generatedAt: '2026-09-19T03:00:00.000Z',
  users: { total: 128, newIn30Days: 14, withoutOrganization: 0 },
  organizations: { total: 40, paid: 12 },
  projects: { active: 57, archived: 9 },
  planBreakdown: [
    {
      planCode: 'free',
      organizationCount: 28,
      memberCount: 30,
      activeProjectCount: 21,
      trialingCount: 0,
    },
    {
      planCode: 'personal',
      organizationCount: 9,
      memberCount: 9,
      activeProjectCount: 18,
      trialingCount: 2,
    },
    {
      planCode: 'team',
      organizationCount: 3,
      memberCount: 14,
      activeProjectCount: 18,
      trialingCount: 1,
    },
    {
      planCode: 'enterprise',
      organizationCount: 0,
      memberCount: 0,
      activeProjectCount: 0,
      trialingCount: 0,
    },
  ],
};

function stub(data: PlatformMetrics = METRICS) {
  server.use(http.get('*/api/v1/admin/metrics', () => HttpResponse.json({ data })));
}

function planRow(name: string): HTMLElement {
  return screen.getByText(name).closest('tr')!;
}

describe('AdminPage (integration)', () => {
  it('全体の会員数とプラン別の内訳を出す (#204)', async () => {
    stub();
    renderWithProviders(<AdminPage />, { route: '/admin' });

    // 上段のタイル
    const tile = (id: string) => screen.getByTestId(`metric-${id}`);
    expect(await screen.findByTestId('metric-users')).toBeInTheDocument();
    expect(within(tile('users')).getByText('128')).toBeInTheDocument();
    expect(within(tile('new-users')).getByText('14')).toBeInTheDocument();
    expect(within(tile('paid-orgs')).getByText('12')).toBeInTheDocument();
    expect(within(tile('paid-orgs')).getByText('/ 40 組織')).toBeInTheDocument();

    // プラン別の行
    const team = planRow('Team');
    expect(within(team).getByText('3')).toBeInTheDocument();
    expect(within(team).getByText('14')).toBeInTheDocument();
    expect(within(planRow('Free')).getByText('28')).toBeInTheDocument();
    // トライアル 0 件は「—」で潰す (0 が並ぶと読みにくい)
    expect(within(planRow('Free')).getByText('—')).toBeInTheDocument();
  });

  it('金額は出さず、売上は Stripe へ送る', async () => {
    // 売上・請求は Stripe が正。二重に持つとズレてどちらが正しいか言えなくなる
    stub();
    renderWithProviders(<AdminPage />, { route: '/admin' });

    const link = await screen.findByRole('link', { name: /Stripe ダッシュボード/ });
    expect(link).toHaveAttribute('href', 'https://dashboard.stripe.com/');
    expect(screen.queryByText(/円/)).not.toBeInTheDocument();
    expect(screen.queryByText(/売上高|MRR|ARR/)).not.toBeInTheDocument();
  });

  it('実効プランで数えていることを画面上で断っておく', async () => {
    stub();
    renderWithProviders(<AdminPage />, { route: '/admin' });

    expect(
      await screen.findByText(/解約済み・支払い不能の組織は\s*Free として計上されます/),
    ).toBeInTheDocument();
  });

  it('いつ時点の数字かを出す', async () => {
    stub();
    renderWithProviders(<AdminPage />, { route: '/admin' });
    expect(await screen.findByText(/集計時刻: 2026\/9\/19/)).toBeInTheDocument();
  });

  it('権限が無い場合 (404) は取得失敗として扱う', async () => {
    // 運営以外には API が 404 を返す。画面の存在自体を気取らせない
    server.use(
      http.get('*/api/v1/admin/metrics', () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 }),
      ),
    );
    renderWithProviders(<AdminPage />, { route: '/admin' });

    expect(await screen.findByText('利用状況を取得できませんでした')).toBeInTheDocument();
  });
});
