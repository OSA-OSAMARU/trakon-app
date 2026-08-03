import type { Meta, StoryObj } from '@storybook/react';
import { PageContainer } from './PageContainer';

const meta = {
  title: 'layout/PageContainer',
  component: PageContainer,
  tags: ['autodocs'],
  argTypes: {
    width: {
      control: 'select',
      options: ['md', 'lg', 'xl'],
    },
  },
  args: {
    children: (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        ページ本文がここに入ります。
      </div>
    ),
  },
} satisfies Meta<typeof PageContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Medium: Story = { args: { width: 'md' } };
export const ExtraLarge: Story = { args: { width: 'xl' } };
