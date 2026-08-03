import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from './textarea';

const meta = {
  title: 'ui/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  args: { placeholder: '備考を入力してください' },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true, defaultValue: '編集不可' } };
