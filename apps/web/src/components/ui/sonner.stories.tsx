import { toast } from 'sonner';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import { Toaster } from './sonner';

const meta = {
  title: 'ui/Toaster',
  component: Toaster,
  tags: ['autodocs'],
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

// アプリでは SidebarLayout に一度だけ配置し、各機能から `toast()` を呼び出して表示する。
export const Default: Story = {
  render: () => (
    <div>
      <Button onClick={() => toast.success('保存しました')}>トーストを表示</Button>
      <Toaster richColors position="bottom-center" />
    </div>
  ),
};
