import type { Meta, StoryObj } from '@storybook/react';
import { ChevronDown } from 'lucide-react';

import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const meta = {
  title: 'ui/Popover',
  component: Popover,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** カレンダーツールバーの月ピッカー (Figma node 18:8) */
export const MonthPicker: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          2026年7月
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <p className="text-body text-text-secondary">表示する月を選びます</p>
      </PopoverContent>
    </Popover>
  ),
};
