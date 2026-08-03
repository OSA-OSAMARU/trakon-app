import type { Meta, StoryObj } from '@storybook/react';
import { Separator } from './separator';

const meta = {
  title: 'ui/Separator',
  component: Separator,
  tags: ['autodocs'],
  argTypes: {
    orientation: {
      control: 'select',
      options: ['horizontal', 'vertical'],
    },
  },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: (args) => (
    <div className="w-64">
      <p className="text-sm">上のコンテンツ</p>
      <Separator {...args} className="my-4" />
      <p className="text-sm">下のコンテンツ</p>
    </div>
  ),
};

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: (args) => (
    <div className="flex h-12 items-center gap-4">
      <span className="text-sm">左</span>
      <Separator {...args} />
      <span className="text-sm">右</span>
    </div>
  ),
};
