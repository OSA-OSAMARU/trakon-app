import type { Meta, StoryObj } from '@storybook/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';

const meta = {
  title: 'ui/Tabs',
  component: Tabs,
  tags: ['autodocs'],
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="active" className="w-80">
      <TabsList>
        <TabsTrigger value="active">進行中</TabsTrigger>
        <TabsTrigger value="archived">アーカイブ済み</TabsTrigger>
      </TabsList>
      <TabsContent value="active" className="mt-4 text-sm">
        進行中のプロジェクト一覧です。
      </TabsContent>
      <TabsContent value="archived" className="mt-4 text-sm">
        アーカイブ済みのプロジェクト一覧です。
      </TabsContent>
    </Tabs>
  ),
};
