import type { Meta, StoryObj } from '@storybook/react';

import { SCHEDULE_THEME_LIST } from './scheduleTheme';
import { ScheduleThemeSwatch } from './ScheduleThemeSwatch';

const meta = {
  title: 'trakon/ScheduleThemeSwatch',
  component: ScheduleThemeSwatch,
  tags: ['autodocs'],
  argTypes: {
    theme: { control: 'select', options: SCHEDULE_THEME_LIST.map((t) => t.key) },
  },
  args: { theme: 'coral' },
} satisfies Meta<typeof ScheduleThemeSwatch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { selected: true } };

/** 予定ごとの色選択 UI の下地 (Figma node 54:2) */
export const Picker: Story = {
  render: () => (
    <div className="bg-background flex w-[280px] flex-wrap gap-3 rounded-lg border border-border p-4">
      {SCHEDULE_THEME_LIST.map((t, i) => (
        <ScheduleThemeSwatch key={t.key} theme={t.key} selected={i === 2} />
      ))}
    </div>
  ),
};
