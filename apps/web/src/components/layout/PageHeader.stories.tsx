import type { Meta, StoryObj } from '@storybook/react';
import { Bell, CalendarDays, ChevronDown, Plus, Search, Settings, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { PageHeader } from './PageHeader';

const meta = {
  title: 'layout/PageHeader',
  component: PageHeader,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'プロジェクト一覧',
    sticky: false,
  },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithDescriptionAndActions: Story = {
  args: {
    description: '担当しているプロジェクトの進行状況を確認できます。',
    actions: (
      <Button>
        <Plus />
        プロジェクトを作成
      </Button>
    ),
  },
};

/** スケジュール画面のヘッダー (Figma node 9:31)。パンくず + 期間 + ツールバー行。 */
export const ScheduleHeader: Story = {
  args: {
    width: 'full',
    breadcrumb: <span>株式会社灯和食品 / ブランドサイト制作 / スケジュール</span>,
    title: '灯和食品　ブランドサイト制作',
    description: '2026. 6.29（月） – 8.31（月）',
    actions: (
      <>
        <div className="relative w-46">
          <Search
            className="text-text-tertiary absolute top-1/2 left-3 size-[18px] -translate-y-1/2"
            aria-hidden
          />
          <Input placeholder="予定を検索" className="bg-content h-10 pl-10" />
        </div>
        <Button variant="secondary" size="icon" aria-label="通知">
          <Bell className="size-5" />
        </Button>
        <Button variant="secondary" size="icon" aria-label="設定">
          <Settings className="size-5" />
        </Button>
        <Button>
          <Plus className="size-5" />
          予定を追加
        </Button>
      </>
    ),
    toolbar: (
      <>
        <CalendarDays className="text-text-secondary size-5" aria-hidden />
        <span className="text-xl font-bold">2026年7月</span>
        <Button variant="ghost" size="icon-sm" aria-label="月を選ぶ">
          <ChevronDown />
        </Button>
        <Button variant="outline" size="sm">
          今日
        </Button>
        <span className="flex-1" />
        <Button variant="outline" size="sm">
          <Users />
          メンバー
        </Button>
      </>
    ),
  },
};
