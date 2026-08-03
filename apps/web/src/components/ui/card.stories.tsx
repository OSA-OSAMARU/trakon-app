import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './card';

const meta = {
  title: 'ui/Card',
  component: Card,
  tags: ['autodocs'],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>プランのタイトル</CardTitle>
        <CardDescription>プランの説明文がここに入ります。</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">カードの本文コンテンツ。</p>
      </CardContent>
      <CardFooter>
        <Button size="sm">アクション</Button>
      </CardFooter>
    </Card>
  ),
};
