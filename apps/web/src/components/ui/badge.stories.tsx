import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta = {
  title: 'ui/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'secondary',
        'neutral',
        'success',
        'warning',
        'danger',
        'brand',
        'destructive',
        'outline',
      ],
    },
    shape: { control: 'select', options: ['rounded', 'pill'] },
    size: { control: 'select', options: ['sm', 'default', 'lg'] },
  },
  args: { children: 'Badge' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Outline: Story = { args: { variant: 'outline' } };
export const Destructive: Story = { args: { variant: 'destructive' } };

/** 列ヘッダーの件数バッジ */
export const Count: Story = {
  args: { variant: 'neutral', shape: 'pill', size: 'lg', children: '10件' },
};
/** 列ヘッダーの FIX 表示 */
export const Fix: Story = {
  args: { variant: 'success', shape: 'pill', size: 'lg', children: 'FIX' },
};
export const Warning: Story = { args: { variant: 'warning', shape: 'pill', children: '進行中' } };
export const Danger: Story = {
  args: { variant: 'danger', shape: 'pill', children: '期限超過 2日' },
};
/** サイドバーのプランバッジ・フォームの「必須」ラベル */
export const Brand: Story = { args: { variant: 'brand', size: 'sm', children: 'PRO' } };
