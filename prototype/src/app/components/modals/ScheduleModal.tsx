import { useState, useEffect } from "react";
import { X, ArrowRight, Trash2 } from "lucide-react";

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

interface Participant {
  id: string;
  name: string;
  organization: string;
  type: "client" | "production";
}

interface Ball {
  id: string;
  name: string;
  deliverableId: string;
}

interface ScheduleModalProps {
  date: string;
  participants: Participant[];
  availableBalls: Ball[];
  editingBall?: {
    id: string;
    name: string;
    from: string;
    to: string;
    startDate: string;
    endDate: string;
    category: BallCategory;
    nextBallId?: string;
    status?: "ready" | "tossed" | "completed";
    isTemporary?: boolean;
  };
  onClose: () => void;
  onCreate: (ball: {
    name: string;
    from: string;
    to: string;
    startDate: string;
    endDate: string;
    category: BallCategory;
    nextBallId?: string;
  }) => void;
  onUpdate?: (ballId: string, updates: {
    name: string;
    from: string;
    to: string;
    startDate: string;
    endDate: string;
    category: BallCategory;
    nextBallId?: string;
  }) => void;
  onLiveUpdate?: (updates: {
    name: string;
    from: string;
    to: string;
    startDate: string;
    endDate: string;
    category: BallCategory;
    nextBallId?: string;
  }) => void;
  onToss?: (ballId: string) => void;
  onDelete?: (ballId: string) => void;
}

export function ScheduleModal({
  date,
  participants,
  availableBalls,
  editingBall,
  onClose,
  onCreate,
  onUpdate,
  onLiveUpdate,
  onToss,
  onDelete,
}: ScheduleModalProps) {
  const [name, setName] = useState(editingBall?.name || "");
  const [from, setFrom] = useState(editingBall?.from || "");
  const [to, setTo] = useState(editingBall?.to || "");
  const [startDate, setStartDate] = useState(editingBall?.startDate || date);
  const [endDate, setEndDate] = useState(editingBall?.endDate || date);
  const [category, setCategory] = useState<BallCategory>(editingBall?.category || "other");
  const [nextBallId, setNextBallId] = useState(editingBall?.nextBallId || "");

  const isEditMode = !!editingBall;

  // Sync form values when editingBall changes (e.g., when card is moved/resized on calendar)
  useEffect(() => {
    if (editingBall) {
      if (editingBall.startDate !== startDate) {
        setStartDate(editingBall.startDate);
      }
      if (editingBall.endDate !== endDate) {
        setEndDate(editingBall.endDate);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingBall?.startDate, editingBall?.endDate]);

  useEffect(() => {
    if (onLiveUpdate && isEditMode) {
      onLiveUpdate({
        name,
        from,
        to,
        startDate,
        endDate,
        category,
        nextBallId: nextBallId || undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, from, to, startDate, endDate, category, nextBallId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const ballData = {
      name,
      from,
      to,
      startDate,
      endDate,
      category,
      nextBallId: nextBallId || undefined,
    };

    if (isEditMode && onUpdate && editingBall && !editingBall.isTemporary) {
      onUpdate(editingBall.id, ballData);
    } else {
      onCreate(ballData);
    }
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-white shadow-2xl pointer-events-auto animate-slide-in-right overflow-y-auto border-l border-border">
        <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-6 py-4 border-b border-border">
          <h2>{isEditMode ? "TOSS予定を編集" : "TOSS予定を作成"}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="name" className="block mb-2 text-sm font-medium">
              予定名 <span className="text-destructive">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          <div>
            <label htmlFor="category" className="block mb-2 text-sm font-medium">
              カテゴリ <span className="text-destructive">*</span>
            </label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as BallCategory)}
              className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              required
            >
              {(Object.keys(CATEGORY_LABELS) as BallCategory[]).map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="from" className="block mb-2 text-sm font-medium">
                FROM <span className="text-destructive">*</span>
              </label>
              <select
                id="from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                required
              >
                <option value="">選択してください</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name} ({p.organization})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="to" className="block mb-2 text-sm font-medium">
                TO <span className="text-destructive">*</span>
              </label>
              <select
                id="to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                required
              >
                <option value="">選択してください</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name} ({p.organization})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="startDate" className="block mb-2 text-sm font-medium">
                開始日 <span className="text-destructive">*</span>
              </label>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            <div>
              <label htmlFor="endDate" className="block mb-2 text-sm font-medium">
                終了日 <span className="text-destructive">*</span>
              </label>
              <input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="nextBall" className="block mb-2 text-sm font-medium">
              次の予定（任意）
            </label>
            <select
              id="nextBall"
              value={nextBallId}
              onChange={(e) => setNextBallId(e.target.value)}
              className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">なし</option>
              {availableBalls.map((ball) => (
                <option key={ball.id} value={ball.id}>
                  {ball.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              TOSS完了時に自動的に次の予定が開始されます
            </p>
          </div>

          {isEditMode && !editingBall?.isTemporary && (
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    if (editingBall && onDelete) {
                      onDelete(editingBall.id);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  削除
                </button>

                {editingBall?.status === "ready" && onToss && (
                  <button
                    type="button"
                    onClick={() => {
                      if (editingBall) {
                        onToss(editingBall.id);
                      }
                    }}
                    className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
                  >
                    <ArrowRight className="w-4 h-4" />
                    TOSSする
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border sticky bottom-0 bg-white -mx-6 px-6 py-4 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-border rounded-md hover:bg-accent transition-colors"
            >
              {isEditMode ? "キャンセル" : "閉じる"}
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              {isEditMode && !editingBall?.isTemporary ? "更新" : "作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
