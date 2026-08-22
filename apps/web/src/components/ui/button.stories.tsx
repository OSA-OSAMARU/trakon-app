import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';

const meta = {
  title: 'ui/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'accent', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon', 'icon-sm'],
    },
  },
  args: { children: 'Button' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** 「次の工程へトス」= 工程を前へ進める唯一のブランド色ボタン */
export const Accent: Story = { args: { variant: 'accent', children: '次の工程へトス' } };
export const Destructive: Story = { args: { variant: 'destructive' } };
export const Outline: Story = { args: { variant: 'outline' } };
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Link: Story = { args: { variant: 'link' } };
/** 36px。「今日」「メンバー」など副次操作 */
export const Small: Story = { args: { size: 'sm', children: '今日' } };
/** 44px。フォームの標準 (Figma node 78:18) */
export const Large: Story = { args: { size: 'lg', children: 'プロジェクトを作成' } };
