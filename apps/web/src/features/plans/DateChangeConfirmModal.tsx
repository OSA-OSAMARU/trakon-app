import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/**
 * ボールをドラッグして日付を変更した際の確認ダイアログ。
 * プロトタイプ DateChangeConfirmModal の移植:
 *  - 「この予定のみ変更」
 *  - 「後続の予定も一緒にずらす」
 */
export function DateChangeConfirmModal({
  ballName,
  onClose,
  onConfirm,
}: {
  ballName: string;
  onClose: () => void;
  onConfirm: (moveSubsequent: boolean) => void;
}) {
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>日程を変更しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            「{ballName}」の日程を変更します。後続の予定の扱いを選んでください。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={() => onConfirm(true)}>
            後続の予定も一緒にずらす
          </Button>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            この予定の後に始まる同じ制作物の予定を、同じ日数分ずらします。
          </p>
          <Button variant="outline" onClick={() => onConfirm(false)}>
            この予定のみ変更
          </Button>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            他の予定の日程は変更しません。
          </p>
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
