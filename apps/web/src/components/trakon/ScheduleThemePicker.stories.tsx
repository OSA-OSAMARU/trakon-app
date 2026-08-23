import type { Meta, StoryObj } from '@storybook/react';

import { ScheduleThemePicker } from './ScheduleThemePicker';

const meta = {
  title: 'trakon/ScheduleThemePicker',
  component: ScheduleThemePicker,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { value: null, fallback: 'cyan', onChange: () => {} },
} satisfies Meta<typeof ScheduleThemePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 未選択。カテゴリ由来の既定色 (cyan) を表示する */
export const Unset: Story = {};
/** ユーザーが選択済み */
export const Selected: Story = { args: { value: 'coral' } };
export const Disabled: Story = { args: { disabled: true } };
