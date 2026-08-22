import type { Meta, StoryObj } from '@storybook/react';

import { PLAN_STATUSES } from './planStatus';
import { StatusPill } from './StatusPill';

const meta = {
  title: 'trakon/StatusPill',
  component: StatusPill,
  tags: ['autodocs'],
  argTypes: {
    status: { control: 'select', options: [...PLAN_STATUSES] },
  },
  args: { status: 'in_progress' },
} satisfies Meta<typeof StatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {};
export const ReviewPending: Story = { args: { status: 'review_pending' } };
export const Approved: Story = { args: { status: 'approved' } };
export const SentBack: Story = { args: { status: 'sent_back' } };
export const Completed: Story = { args: { status: 'completed' } };

/** ボール状態機械 6 値すべて */
export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {PLAN_STATUSES.map((s) => (
        <StatusPill key={s} status={s} />
      ))}
    </div>
  ),
};
