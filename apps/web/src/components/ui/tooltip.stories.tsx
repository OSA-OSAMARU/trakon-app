import type { Meta, StoryObj } from '@storybook/react';

import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const meta = {
  title: 'ui/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 履歴タブで相対時刻に絶対日時を重ねる表示 (Figma node 49:2) */
export const EventTimestamp: Story = {
  render: () => (
    <Tooltip open>
      <TooltipTrigger asChild>
        <span className="text-mini text-text-tertiary">3日前</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">2026.7.24（金）16:42</TooltipContent>
    </Tooltip>
  ),
};
