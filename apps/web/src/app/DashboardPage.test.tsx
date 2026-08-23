import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { DashboardPage } from './DashboardPage';
import type { Dashboard, DashboardTask } from '@/features/dashboard/api';

const task = (over: Partial<DashboardTask> & { planId: string; title: string }): DashboardTask => ({
  projectId: 'p1',
  itemId: 'it1',
  itemName: 'LP',
  category: 'design',
  scheduledDate: '2026-06-21',
  dueDate: null,
  ballState: 'in_progress',
  isOverdue: false,
  progressManager: { id: 'm9', name: '横山 直樹' },
  ...over,
});

const dashboard: Dashboard = {
  today: '2026-06-21',
  summary: { todayTaskCount: 4, overdueCount: 1 },
  projects: [
    {
      id: 'p1',
      name: 'サンプル制作案件',
      memberSections: [
        {
          member: {
            id: 'm1',
            name: '山田 太郎',
            organizationName: 'Acme',
            memberType: 'production',
            isMe: true,
          },
          tasks: [
            task({ planId: 'pl1', title: 'デザインカンプ作成', isOverdue: true, dueDate: '2026-06-18' }),
            task({ planId: 'pl2', title: '承認待ちの予定', ballState: 'review_pending' }),
          ],
        },
        {
          member: {
            id: 'm2',
            name: '他人 花子',
            organizationName: 'Acme',
            memberType: 'client',
            isMe: false,
          },
          tasks: [
            task({ planId: 'pl3', title: '差し戻された予定', ballState: 'sent_back' }),
            task({ planId: 'pl4', title: 'TOSS 待ちの予定', ballState: 'approved' }),
          ],
        },
      ],
    },
    {
      id: 'p2',
      name: '別プロジェクト',
      memberSections: [
        {
          member: {
            id: 'm3',
            name: '別 太郎',
            organizationName: 'Acme',
            memberType: 'production',
            isMe: false,
          },
          tasks: [task({ planId: 'pl5', projectId: 'p2', title: '別案件の予定' })],
        },
      ],
    },
  ],
};

function stub(d: Dashboard = dashboard) {
  server.use(http.get('*/api/v1/users/me/dashboard', () => HttpResponse.json({ data: d })));
}

/** 列見出しから、その列のカード領域を取り出す。 */
function column(name: string) {
  return screen.getByRole('heading', { name }).closest('section')!;
}

describe('DashboardPage (integration)', () => {
  it('ボール状態に応じて 4 列へ振り分ける', async () => {
    stub();
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('デザインカンプ作成')).toBeInTheDocument();
    expect(within(column('作業中')).getByText('デザインカンプ作成')).toBeInTheDocument();
    expect(within(column('返答待ち')).getByText('承認待ちの予定')).toBeInTheDocument();
    expect(within(column('RETURN対応')).getByText('差し戻された予定')).toBeInTheDocument();
    expect(within(column('次の工程TOSS待ち')).getByText('TOSS 待ちの予定')).toBeInTheDocument();
  });

  it('カードにプロジェクト・保持者・進行責任者・期限を出す', async () => {
    stub();
    renderWithProviders(<DashboardPage />);

    const card = (await screen.findByText('デザインカンプ作成')).closest('a')!;
    expect(within(card).getByText('サンプル制作案件｜LP')).toBeInTheDocument();
    expect(within(card).getByText('山田 太郎')).toBeInTheDocument();
    expect(within(card).getByText('進行責任者 横山 直樹')).toBeInTheDocument();
    expect(within(card).getByText('期限超過')).toBeInTheDocument();
    // クリックでその予定の詳細ドロワーを開く
    expect(card).toHaveAttribute(
      'href',
      '/projects/p1/items/it1?modal=ball-detail&planId=pl1',
    );
  });

  it('「要対応のみ」で自分が保持しているボールだけに絞る', async () => {
    stub();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('差し戻された予定')).toBeInTheDocument();
    await user.click(screen.getByLabelText('要対応のみ'));

    expect(screen.getByText('デザインカンプ作成')).toBeInTheDocument();
    expect(screen.queryByText('差し戻された予定')).not.toBeInTheDocument();
  });

  it('tossed / completed のボールはボードに出さない', async () => {
    stub({
      ...dashboard,
      projects: [
        {
          id: 'p1',
          name: 'サンプル制作案件',
          memberSections: [
            {
              member: {
                id: 'm1',
                name: '山田 太郎',
                organizationName: 'Acme',
                memberType: 'production',
                isMe: true,
              },
              tasks: [
                task({ planId: 'pl1', title: '通常の予定' }),
                task({ planId: 'pl9', title: 'TOSS 済みの予定', ballState: 'tossed' }),
              ],
            },
          ],
        },
      ],
    });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('通常の予定')).toBeInTheDocument();
    expect(screen.queryByText('TOSS 済みの予定')).not.toBeInTheDocument();
  });

  it('取得失敗時はエラーメッセージを表示する', async () => {
    server.use(
      http.get('*/api/v1/users/me/dashboard', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('ダッシュボードの取得に失敗しました。')).toBeInTheDocument();
  });
});
