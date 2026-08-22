import type { Meta, StoryObj } from '@storybook/react';

import { Wordmark } from './Wordmark';

const meta = {
  title: 'trakon/Wordmark',
  component: Wordmark,
  tags: ['autodocs'],
  argTypes: { size: { control: 'select', options: ['sm', 'md'] } },
} satisfies Meta<typeof Wordmark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** サイドバー (Figma node 9:3、Sora SemiBold 32px) */
export const Sidebar: Story = {};
/** 公開ページのヘッダー */
export const Small: Story = { args: { size: 'sm' } };
