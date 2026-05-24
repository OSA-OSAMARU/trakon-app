import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Calendar } from "lucide-react";
import { useDrag, useDrop } from "react-dnd";
import { BallDetailModal } from "../modals/BallDetailModal";

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
}

interface DraggableBallCardProps {
  ball: Ball;
  deliverableName: string;
  onClick: (ball: Ball) => void;
}

function DraggableBallCard({ ball, deliverableName, onClick }: DraggableBallCardProps) {
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: "KANBAN_BALL",
      item: { ballId: ball.id },
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [ball.id]
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(ball.endDate);
  endDate.setHours(0, 0, 0, 0);

  const isOverdue = ball.status === "ready" && endDate < today;
  const isTossed = ball.status === "tossed";

  return (
    <button
      ref={drag}
      onClick={() => onClick(ball)}
      className={`w-full border-2 rounded-lg p-4 hover:shadow-md transition-all text-left cursor-move ${
        isOverdue
          ? "bg-red-50 border-red-400 hover:border-red-500"
          : isTossed
          ? "bg-gray-100 border-gray-300 hover:border-gray-400"
          : "bg-white border-primary/20 hover:border-primary/40"
      }`}
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className={`font-medium truncate mb-1 ${isOverdue ? "text-red-700" : ""}`}>
            {ball.name}
          </div>
          <div className="text-xs text-muted-foreground">{deliverableName}</div>
        </div>
        <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1.5 ml-2" />
      </div>

      <div className={`text-xs mb-3 ${isOverdue ? "text-red-600" : "text-muted-foreground"}`}>
        {ball.startDate} 〜 {ball.endDate}
      </div>

      <div className="flex items-center justify-between text-xs pt-2 border-t border-border">
        <div>
          <span className="text-muted-foreground">Next: </span>
          <span className="font-medium">{ball.to}</span>
        </div>
        <div className={`px-2 py-1 rounded ${
          isTossed ? "bg-gray-200 text-gray-600" : "bg-muted text-muted-foreground"
        }`}>
          {ball.status === "ready" ? "準備中" : "TOSS済み"}
        </div>
      </div>
    </button>
  );
}

interface MemberColumnProps {
  participant: {
    id: string;
    name: string;
    organization: string;
    type: "production" | "client";
  };
  balls: Ball[];
  onBallClick: (ball: Ball) => void;
  onDrop: (ballId: string, newBallHolder: string) => void;
  getDeliverableName: (deliverableId: string) => string;
}

function MemberColumn({
  participant,
  balls,
  onBallClick,
  onDrop,
  getDeliverableName,
}: MemberColumnProps) {
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: "KANBAN_BALL",
      drop: (item: { ballId: string }) => {
        onDrop(item.ballId, participant.name);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
      }),
    }),
    [participant.name, onDrop]
  );

  return (
    <div ref={drop} className="flex flex-col">
      <div className="bg-white border border-border rounded-lg p-4 mb-3">
        <h3 className="mb-1">{participant.name}</h3>
        <p className="text-sm text-muted-foreground">{participant.organization}</p>
        <div className="mt-2 text-sm">
          <span className="text-muted-foreground">担当中: </span>
          <span className="font-medium text-primary">{balls.length}件</span>
        </div>
      </div>

      <div
        className={`space-y-3 transition-all ${
          isOver ? "bg-primary/5 border-2 border-dashed border-primary rounded-lg p-2" : ""
        }`}
      >
        {balls.map((ball) => (
          <DraggableBallCard
            key={ball.id}
            ball={ball}
            deliverableName={getDeliverableName(ball.deliverableId)}
            onClick={onBallClick}
          />
        ))}

        {balls.length === 0 && (
          <div className="bg-muted/30 border border-dashed border-border rounded-lg p-6 text-center">
            <p className="text-sm text-muted-foreground">担当中の予定はありません</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function MemberKanbanPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [ballDetailModalOpen, setBallDetailModalOpen] = useState(false);
  const [selectedBall, setSelectedBall] = useState<Ball | null>(null);

  const mockDeliverables = [
    { id: "1", name: "トップページ" },
    { id: "2", name: "商品一覧ページ" },
    { id: "3", name: "商品詳細ページ" },
  ];

  const mockParticipants = [
    { id: "1", name: "田中 太郎", organization: "制作会社A", type: "production" as const },
    { id: "2", name: "佐藤 花子", organization: "制作会社A", type: "production" as const },
    { id: "3", name: "鈴木 次郎", organization: "クライアントB", type: "client" as const },
  ];

  const [balls, setBalls] = useState<Ball[]>([
    {
      id: "1",
      name: "初稿デザイン",
      from: "田中 太郎",
      to: "鈴木 次郎",
      startDate: "2026-05-10",
      endDate: "2026-05-20",
      status: "ready",
      ballHolder: "田中 太郎",
      deliverableId: "1",
    },
    {
      id: "2",
      name: "確認戻し",
      from: "鈴木 次郎",
      to: "佐藤 花子",
      startDate: "2026-05-21",
      endDate: "2026-05-25",
      status: "tossed",
      ballHolder: "鈴木 次郎",
      deliverableId: "1",
    },
    {
      id: "3",
      name: "コーディング",
      from: "佐藤 花子",
      to: "田中 太郎",
      startDate: "2026-05-15",
      endDate: "2026-05-28",
      status: "ready",
      ballHolder: "佐藤 花子",
      deliverableId: "1",
    },
    {
      id: "4",
      name: "ワイヤーフレーム作成",
      from: "田中 太郎",
      to: "鈴木 次郎",
      startDate: "2026-05-08",
      endDate: "2026-05-12",
      status: "ready",
      ballHolder: "田中 太郎",
      deliverableId: "2",
    },
    {
      id: "5",
      name: "デザイン実装",
      from: "佐藤 花子",
      to: "鈴木 次郎",
      startDate: "2026-05-13",
      endDate: "2026-05-22",
      status: "ready",
      ballHolder: "佐藤 花子",
      deliverableId: "2",
    },
  ]);

  const handleBallClick = (ball: Ball) => {
    setSelectedBall(ball);
    setBallDetailModalOpen(true);
  };

  const handleToss = (ballId: string) => {
    setBalls(
      balls.map((ball) =>
        ball.id === ballId
          ? { ...ball, status: "tossed" as const, ballHolder: ball.to }
          : ball
      )
    );
    setBallDetailModalOpen(false);
  };

  const handleComplete = (ballId: string) => {
    setBalls(
      balls.map((ball) =>
        ball.id === ballId ? { ...ball, status: "completed" as const } : ball
      )
    );
    setBallDetailModalOpen(false);
  };

  const handleDelete = (ballId: string) => {
    setBalls(balls.filter((ball) => ball.id !== ballId));
    setBallDetailModalOpen(false);
  };

  const handleReturn = (ballId: string) => {
    setBalls(
      balls.map((ball) =>
        ball.id === ballId
          ? { ...ball, status: "ready" as const, ballHolder: ball.from }
          : ball
      )
    );
    setBallDetailModalOpen(false);
  };

  const handleTossByDrag = (ballId: string, newBallHolder: string) => {
    setBalls(
      balls.map((ball) =>
        ball.id === ballId
          ? {
              ...ball,
              status: "tossed" as const,
              ballHolder: newBallHolder,
              to: newBallHolder,
            }
          : ball
      )
    );
  };

  const clientParticipants = mockParticipants.filter((p) => p.type === "client");
  const productionParticipants = mockParticipants.filter((p) => p.type === "production");

  const getDeliverableName = (deliverableId: string) => {
    return mockDeliverables.find((d) => d.id === deliverableId)?.name || "";
  };

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="bg-white border-b border-border sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="mb-1">メンバービュー</h1>
              <p className="text-muted-foreground">
                プロジェクト: ECサイトリニューアル
              </p>
            </div>
            <button
              onClick={() => navigate(`/projects/${projectId}/deliverables/1`)}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-md hover:bg-accent transition-colors"
            >
              <Calendar className="w-4 h-4" />
              スケジュールビュー
            </button>
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="mb-6">
          <h2 className="mb-4">制作チーム</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {productionParticipants.map((participant) => {
              const participantBalls = balls.filter(
                (b) => b.ballHolder === participant.name && b.status !== "completed"
              );

              return (
                <MemberColumn
                  key={participant.id}
                  participant={participant}
                  balls={participantBalls}
                  onBallClick={handleBallClick}
                  onDrop={handleTossByDrag}
                  getDeliverableName={getDeliverableName}
                />
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="mb-4">クライアント</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {clientParticipants.map((participant) => {
              const participantBalls = balls.filter(
                (b) => b.ballHolder === participant.name && b.status !== "completed"
              );

              return (
                <MemberColumn
                  key={participant.id}
                  participant={participant}
                  balls={participantBalls}
                  onBallClick={handleBallClick}
                  onDrop={handleTossByDrag}
                  getDeliverableName={getDeliverableName}
                />
              );
            })}
          </div>
        </div>
      </main>

      {ballDetailModalOpen && selectedBall && (
        <BallDetailModal
          ball={selectedBall}
          onClose={() => setBallDetailModalOpen(false)}
          onToss={handleToss}
          onComplete={handleComplete}
          onDelete={handleDelete}
          onReturn={handleReturn}
        />
      )}
    </div>
  );
}
