import type { Meta, StoryObj } from '@storybook/react';
import { Avatar } from './avatar';

const meta = {
  title: 'ui/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  args: { name: '田中太郎', className: 'size-8 text-xs' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Large: Story = { args: { className: 'size-12 text-base' } };
