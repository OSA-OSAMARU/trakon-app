import { X } from "lucide-react";

interface DateChangeConfirmModalProps {
  ballName: string;
  onClose: () => void;
  onConfirm: (moveSubsequent: boolean) => void;
}

export function DateChangeConfirmModal({
  ballName,
  onClose,
  onConfirm,
}: DateChangeConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2>期間変更の確認</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-muted-foreground mb-6">
            「{ballName}」の期間を変更します。同じ制作物の後続予定をどうしますか？
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => onConfirm(false)}
              className="w-full px-4 py-3 border-2 border-border rounded-md hover:bg-accent transition-colors text-left"
            >
              <div className="font-medium mb-1">この予定のみ変更</div>
              <div className="text-xs text-muted-foreground">
                他の予定の日程は変更しません
              </div>
            </button>

            <button
              onClick={() => onConfirm(true)}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-left"
            >
              <div className="font-medium mb-1">後続の予定も一緒にずらす</div>
              <div className="text-xs opacity-90">
                この予定の後に始まる予定を同じ日数分ずらします
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
