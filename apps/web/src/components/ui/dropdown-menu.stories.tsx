import type { Meta, StoryObj } from '@storybook/react';
import { Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

const meta = {
  title: 'ui/DropdownMenu',
  component: DropdownMenu,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** スケジュールカード右上の「⋯」メニュー (Figma node 11:5) */
export const PlanCardMenu: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="操作メニュー">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Webデザイン</DropdownMenuLabel>
        <DropdownMenuItem>
          <Pencil />
          編集
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy />
          複製
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2 />
          削除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
