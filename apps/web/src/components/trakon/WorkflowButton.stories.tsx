import type { Meta, StoryObj } from '@storybook/react';

import { WorkflowButton } from './WorkflowButton';
import { WORKFLOW_ACTIONS } from './workflow';

const meta = {
  title: 'trakon/WorkflowButton',
  component: WorkflowButton,
  tags: ['autodocs'],
  argTypes: {
    action: { control: 'select', options: [...WORKFLOW_ACTIONS] },
  },
  args: { action: 'review-toss' },
} satisfies Meta<typeof WorkflowButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewToss: Story = {};
export const CommentReturn: Story = { args: { action: 'comment-return' } };
export const Approve: Story = { args: { action: 'approve' } };
export const NextToss: Story = { args: { action: 'next-toss' } };

/** サイドモーダルのフッターに並ぶ形 (Figma node 35:882) */
export const FooterPair: Story = {
  render: () => (
    <div className="bg-background flex w-[432px] gap-3 rounded-lg border border-border p-4">
      <WorkflowButton action="comment-return" />
      <WorkflowButton action="approve" />
    </div>
  ),
};

/** 4 種の並び (Figma node 42:4) */
export const AllActions: Story = {
  render: () => (
    <div className="bg-surface-muted flex flex-wrap gap-4 rounded-lg p-6">
      {WORKFLOW_ACTIONS.map((action) => (
        <WorkflowButton key={action} action={action} className="w-[208px] flex-none" />
      ))}
    </div>
  ),
};
