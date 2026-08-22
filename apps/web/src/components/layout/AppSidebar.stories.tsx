import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';

import { AppSidebar } from './AppSidebar';

// デモデータは Figma node 20:2 の架空名称に揃える
const PROJECTS = [
  { id: 'p1', name: '灯和食品｜ブランドサイト' },
  { id: 'p2', name: '青庭不動産｜採用サイト' },
  { id: 'p3', name: 'ひより書房｜新刊特設' },
  { id: 'p4', name: '澄川製作所｜企業サイト' },
];

const meta: Meta<typeof AppSidebar> = {
  title: 'layout/AppSidebar',
  component: AppSidebar,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      // 1 つ目のプロジェクトを選択中にした状態で見せる
      <MemoryRouter initialEntries={['/projects/p1']}>
        <div className="bg-content flex h-[720px]">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
  args: {
    projects: PROJECTS,
    user: { displayName: '佐藤 航', email: 'sato@example.jp' },
    onOpenProfile: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof AppSidebar>;

export const Default: Story = {};

/** 読込中・未ログイン */
export const Loading: Story = { args: { user: null } };

/** プロジェクト 0 件 */
export const Empty: Story = { args: { projects: [] } };
