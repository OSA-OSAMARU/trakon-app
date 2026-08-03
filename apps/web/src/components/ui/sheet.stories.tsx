import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetClose } from './sheet';

const meta = {
  title: 'ui/Sheet',
  component: Sheet,
  tags: ['autodocs'],
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

// Sheet は `@radix-ui/react-dialog` を modal={false} で使う非ブロッキングパネルで、
// アプリ内では SheetTrigger を使わず親コンポーネントが `open` を制御する。
export const Default: Story = {
  render: function Render() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button onClick={() => setOpen(true)}>予定を作成</Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>新しい予定</SheetTitle>
              <SheetDescription>カレンダーに新しい工程予定を追加します。</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="outline">閉じる</Button>
              </SheetClose>
              <Button>保存</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </>
    );
  },
};
