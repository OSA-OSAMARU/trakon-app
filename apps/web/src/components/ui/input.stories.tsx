import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './input';

const meta = {
  title: 'ui/Input',
  component: Input,
  tags: ['autodocs'],
  args: { placeholder: 'テキストを入力' },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true, value: '編集不可' } };
export const Invalid: Story = { args: { 'aria-invalid': true, defaultValue: '不正な値' } };
