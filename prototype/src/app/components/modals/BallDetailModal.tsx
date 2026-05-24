import { X, ArrowRight, CheckCircle, Trash2, Edit2, Undo2 } from "lucide-react";

type BallCategory =
  | "wireframe"
  | "design"
  | "coding"
  | "review"
  | "meeting"
  | "other";

const CATEGORY_LABELS: Record<BallCategory, string> = {
  wireframe: "ワイヤー作成",
  design: "デザイン",
  coding: "コーディング",
  review: "レビュー",
  meeting: "ミーティング",
  other: "その他",
};

interface Ball {
  id: string;
  name: string;
  from: string;
  to: string;
  startDate: string;
  endDate: string;
  status: "ready" | "tossed" | "completed";
  ballHolder: string;
  deliverableId: string;
  category: BallCategory;
  nextBallId?: string;
}

interface BallDetailModalProps {
  ball: Ball;
  nextBallName?: string;
  onClose: () => void;
  onToss: (ballId: string) => void;
  onComplete: (ballId: string) => void;
  onDelete: (ballId: string) => void;
  onReturn?: (ballId: string) => void;
}

export function BallDetailModal({
  ball,
  nextBallName,
  onClose,
  onToss,
  onComplete,
  onDelete,
  onReturn,
}: BallDetailModalProps) {
  const handleToss = () => {
    onToss(ball.id);
  };

  const handleComplete = () => {
    onComplete(ball.id);
  };

  const handleDelete = () => {
    onDelete(ball.id);
  };

  const handleReturn = () => {
    if (onReturn) {
      onReturn(ball.id);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2>ボール詳細</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h3 className="mb-4">{ball.name}</h3>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-muted-foreground mb-1">FROM</div>
              <div className="font-medium">{ball.from}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">TO</div>
              <div className="font-medium">{ball.to}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-muted-foreground mb-1">開始日</div>
              <div className="font-medium">{ball.startDate}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">終了日</div>
              <div className="font-medium">{ball.endDate}</div>
            </div>
          </div>

          <div>
            <div className="text-muted-foreground mb-1">カテゴリ</div>
            <div className="font-medium">{CATEGORY_LABELS[ball.category]}</div>
          </div>

          <div>
            <div className="text-muted-foreground mb-1">Ball Holder</div>
            <div className="font-medium">{ball.ballHolder}</div>
          </div>

          {ball.nextBallId && nextBallName && (
            <div>
              <div className="text-muted-foreground mb-1">次の予定</div>
              <div className="font-medium">{nextBallName}</div>
              <p className="text-xs text-muted-foreground mt-1">
                TOSS完了時に自動的に開始されます
              </p>
            </div>
          )}

          <div>
            <div className="text-muted-foreground mb-1">ステータス</div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted rounded-md">
              {ball.status === "ready" && "準備中"}
              {ball.status === "tossed" && "TOSS済み"}
              {ball.status === "completed" && "完了"}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-border">
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-4 py-2 text-destructive hover:bg-destructive/10 rounded-md transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              削除
            </button>
            <div className="flex items-center gap-3">
              {ball.status === "ready" && (
                <button
                  onClick={handleToss}
                  className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
                >
                  <ArrowRight className="w-4 h-4" />
                  TOSSする
                </button>
              )}
              {ball.status === "tossed" && (
                <>
                  {onReturn && (
                    <button
                      onClick={handleReturn}
                      className="flex items-center gap-2 px-6 py-2.5 border border-border rounded-md hover:bg-accent transition-colors"
                    >
                      <Undo2 className="w-4 h-4" />
                      差し戻し
                    </button>
                  )}
                  <button
                    onClick={handleComplete}
                    className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
                  >
                    <CheckCircle className="w-4 h-4" />
                    完了
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
