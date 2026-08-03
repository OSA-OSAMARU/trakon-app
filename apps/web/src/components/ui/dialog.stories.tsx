import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from './dialog';

const meta = {
  title: 'ui/Dialog',
  component: Dialog,
  tags: ['autodocs'],
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// アプリ内では DialogTrigger を使わず、親コンポーネントが `open` state を制御する。
export const Default: Story = {
  render: function Render() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button onClick={() => setOpen(true)}>ダイアログを開く</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>プランを削除しますか？</DialogTitle>
              <DialogDescription>
                この操作は取り消せません。関連する工程のデータも削除されます。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">キャンセル</Button>
              </DialogClose>
              <Button variant="destructive">削除する</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  },
};
