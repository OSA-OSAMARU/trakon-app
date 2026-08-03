import type { Meta, StoryObj } from '@storybook/react';
import { DateField } from './date-field';

const meta = {
  title: 'ui/DateField',
  component: DateField,
  tags: ['autodocs'],
} satisfies Meta<typeof DateField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithValue: Story = { args: { defaultValue: '2026-08-04' } };
