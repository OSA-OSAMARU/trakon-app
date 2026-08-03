import type { Meta, StoryObj } from '@storybook/react';
import { PageHeader } from './PageHeader';
import { Button } from '@/components/ui/button';

const meta = {
  title: 'layout/PageHeader',
  component: PageHeader,
  tags: ['autodocs'],
  args: {
    title: 'プロジェクト一覧',
  },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithDescriptionAndActions: Story = {
  args: {
    description: '担当しているプロジェクトの進行状況を確認できます。',
    actions: <Button size="sm">新規プロジェクト</Button>,
  },
};
