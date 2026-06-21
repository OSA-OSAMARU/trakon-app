import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { DashboardPage } from './DashboardPage';
import type { Dashboard } from '@/features/dashboard/api';

const dashboard: Dashboard = {
  today: '2026-06-21',
  summary: { todayTaskCount: 2, overdueCount: 1 },
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
          },
          tasks: [
            {
              planId: 'pl1',
              projectId: 'p1',
              itemId: 'it1',
              itemName: 'LP',
              title: 'デザインカンプ作成',
              category: 'design',
              scheduledDate: '2026-06-21',
              dueDate: null,
              ballState: 'tossed',
              isOverdue: false,
            },
          ],
        },
      ],
    },
  ],
};

describe('DashboardPage (integration)', () => {
  it('API 応答からプロジェクト・メンバー・タスクを描画する', async () => {
    server.use(
      http.get('*/api/v1/users/me/dashboard', () => HttpResponse.json({ data: dashboard })),
    );

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('デザインカンプ作成')).toBeInTheDocument();
    expect(screen.getByText('サンプル制作案件')).toBeInTheDocument();
    expect(screen.getByText('山田 太郎')).toBeInTheDocument();
    // サマリーラベル
    expect(screen.getByText('今日のタスク')).toBeInTheDocument();
    expect(screen.getByText('期限超過')).toBeInTheDocument();
  });

  it('取得失敗時はエラーメッセージを表示する', async () => {
    server.use(
      http.get('*/api/v1/users/me/dashboard', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );

    renderWithProviders(<DashboardPage />);

    expect(
      await screen.findByText('ダッシュボードの取得に失敗しました。'),
    ).toBeInTheDocument();
  });
});
