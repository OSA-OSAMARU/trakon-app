import { useState, useEffect } from "react";
import * as React from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { ArrowLeft, Settings, Users, ZoomIn, ZoomOut } from "lucide-react";
import { useDrag, useDrop } from "react-dnd";
import { ScheduleModal } from "../modals/ScheduleModal";
import { DateChangeConfirmModal } from "../modals/DateChangeConfirmModal";

type BallCategory =
  | "wireframe"
  | "design"
  | "coding"
  | "review"
  | "meeting"
  | "other";

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
  isTemporary?: boolean;
}

const CATEGORY_COLORS: Record<BallCategory, { bg: string; border: string; text: string }> = {
  wireframe: { bg: "bg-purple-50", border: "border-purple-300", text: "text-purple-700" },
  design: { bg: "bg-blue-50", border: "border-blue-300", text: "text-blue-700" },
  coding: { bg: "bg-green-50", border: "border-green-300", text: "text-green-700" },
  review: { bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-700" },
  meeting: { bg: "bg-yellow-50", border: "border-yellow-300", text: "text-yellow-700" },
  other: { bg: "bg-gray-50", border: "border-gray-300", text: "text-gray-700" },
};

const CATEGORY_LABELS: Record<BallCategory, string> = {
  wireframe: "ワイヤー作成",
  design: "デザイン",
  coding: "コーディング",
  review: "レビュー",
  meeting: "ミーティング",
  other: "その他",
};

interface DraggableBallProps {
  ball: Ball;
  position: { top: number; height: number };
  lane: number;
  laneWidth: number;
  rowHeight: number;
  startDate: Date;
  onClick: (ball: Ball) => void;
  onResize: (ballId: string, newStartDate: string, newEndDate: string) => void;
}

function DraggableBall({
  ball,
  position,
  lane,
  laneWidth,
  rowHeight,
  startDate,
  onClick,
  onResize,
}: DraggableBallProps) {
  const [isResizing, setIsResizing] = React.useState<"top" | "bottom" | null>(null);
  const [resizeStartY, setResizeStartY] = React.useState(0);
  const [resizeStartDate, setResizeStartDate] = React.useState("");
  const [resizeEndDate, setResizeEndDate] = React.useState("");

  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: "BALL",
      item: { ballId: ball.id, deliverableId: ball.deliverableId },
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
      canDrag: () => !isResizing,
    }),
    [ball.id, ball.deliverableId, isResizing]
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(ball.endDate);
  endDate.setHours(0, 0, 0, 0);

  const isOverdue = ball.status === "ready" && endDate < today;
  const isCompleted = ball.status === "completed";
  const isTemporary = ball.isTemporary;

  const todayStr = today.toISOString().split("T")[0];
  const isActive = !isCompleted && ball.startDate <= todayStr && ball.endDate >= todayStr;

  const cardHeight = position.height - 8;
  const isCompact = cardHeight < 120;
  const isMini = cardHeight < 80;

  const formatCompactDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const categoryColors = CATEGORY_COLORS[ball.category];
  const cardStyle = isTemporary
    ? "bg-white border-dashed border-primary/40 opacity-80"
    : isCompleted
    ? "bg-gray-50 border-gray-200 opacity-60"
    : isOverdue
    ? "bg-red-50 border-red-400"
    : `${categoryColors.bg} ${categoryColors.border}`;

  const activeStyle = isActive && !isCompleted && !isTemporary ? "ring-4 ring-primary/30 shadow-lg" : "";

  const handleResizeStart = (e: React.MouseEvent, edge: "top" | "bottom") => {
    e.stopPropagation();
    setIsResizing(edge);
    setResizeStartY(e.clientY);
    setResizeStartDate(ball.startDate);
    setResizeEndDate(ball.endDate);
  };

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizeStartY;
      const daysDelta = Math.round(deltaY / rowHeight);

      if (isResizing === "top") {
        const newStart = new Date(resizeStartDate);
        newStart.setDate(newStart.getDate() + daysDelta);
        const newStartStr = newStart.toISOString().split("T")[0];

        if (newStartStr <= resizeEndDate) {
          onResize(ball.id, newStartStr, resizeEndDate);
        }
      } else if (isResizing === "bottom") {
        const newEnd = new Date(resizeEndDate);
        newEnd.setDate(newEnd.getDate() + daysDelta);
        const newEndStr = newEnd.toISOString().split("T")[0];

        if (newEndStr >= resizeStartDate) {
          onResize(ball.id, resizeStartDate, newEndStr);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, resizeStartY, resizeStartDate, resizeEndDate, rowHeight, ball.id, onResize]);

  return (
    <div
      id={`ball-${ball.id}`}
      ref={drag}
      className={`absolute text-sm rounded-lg border-2 transition-all hover:shadow-lg hover:z-10 group ${cardStyle} ${activeStyle}`}
      style={{
        top: `${position.top + 4}px`,
        height: `${cardHeight}px`,
        left: `${lane * laneWidth + 12}px`,
        width: `${laneWidth - 24}px`,
        opacity: isDragging ? 0.5 : 1,
        cursor: isResizing ? "ns-resize" : "move",
      }}
    >
      {!isMini && (
        <>
          <div
            className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity"
            onMouseDown={(e) => handleResizeStart(e, "top")}
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-primary/40 rounded-full" />
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity"
            onMouseDown={(e) => handleResizeStart(e, "bottom")}
          >
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-primary/40 rounded-full" />
          </div>
        </>
      )}

      <button
        onClick={() => onClick(ball)}
        className="w-full h-full px-3 py-2 text-left"
      >
        {isMini ? (
          <div className="flex flex-col h-full justify-center">
            <div className={`font-medium truncate text-xs ${isOverdue ? "text-red-700" : ""}`}>
              {ball.name || "新規予定"}
            </div>
            {ball.ballHolder && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0" />
                <span className="text-xs font-medium text-primary truncate">
                  {ball.ballHolder}
                </span>
              </div>
            )}
          </div>
        ) : isCompact ? (
          <div className="flex flex-col h-full gap-1.5">
            <div className={`font-medium truncate ${isOverdue ? "text-red-700" : ""}`}>
              {ball.name || "新規予定"}
            </div>
            <div className={`text-xs truncate ${isOverdue ? "text-red-600" : "text-muted-foreground"}`}>
              {formatCompactDate(ball.startDate)} 〜 {formatCompactDate(ball.endDate)}
            </div>
            {ball.ballHolder && (
              <div className="flex items-center gap-2 bg-primary/10 px-2 py-1 rounded mt-auto">
                <div className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0" />
                <span className="text-xs font-medium text-primary truncate">
                  {ball.ballHolder}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-full gap-2">
            <div className={`font-medium truncate ${isOverdue ? "text-red-700" : ""}`}>
              {ball.name || "新規予定"}
            </div>
            <div className={`text-xs ${isOverdue ? "text-red-600" : "text-muted-foreground"}`}>
              {new Date(ball.startDate).getFullYear()}/{new Date(ball.startDate).getMonth() + 1}/{new Date(ball.startDate).getDate()} 〜 {new Date(ball.endDate).getFullYear()}/{new Date(ball.endDate).getMonth() + 1}/{new Date(ball.endDate).getDate()}
            </div>

            <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-border">
              {ball.ballHolder && (
                <div className="flex items-center gap-2 bg-primary/10 px-2 py-1.5 rounded">
                  <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-0.5">Ball Holder</div>
                    <span className="text-xs font-medium text-primary truncate block">
                      {ball.ballHolder}
                    </span>
                  </div>
                </div>
              )}

              {ball.to && (
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-0.5">Next</div>
                    <span className="text-xs truncate block">{ball.to}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </button>
    </div>
  );
}

interface DroppableDateRowProps {
  date: Date;
  index: number;
  rowHeight: number;
  deliverableId: string;
  onDrop: (ballId: string, newStartDate: string) => void;
  onClick: (date: string, deliverableId: string) => void;
  isWeekend: boolean;
  isHoliday: boolean;
  isToday: boolean;
  isFirstOfMonth: boolean;
}

function DroppableDateRow({
  date,
  index,
  rowHeight,
  deliverableId,
  onDrop,
  onClick,
  isWeekend,
  isHoliday,
  isToday,
  isFirstOfMonth,
}: DroppableDateRowProps) {
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: "BALL",
      drop: (item: { ballId: string; deliverableId: string }) => {
        if (item.deliverableId === deliverableId) {
          onDrop(item.ballId, date.toISOString().split("T")[0]);
        }
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
      }),
    }),
    [date, deliverableId, onDrop]
  );

  const handleClick = () => {
    onClick(date.toISOString().split("T")[0], deliverableId);
  };

  return (
    <div
      ref={drop}
      onClick={handleClick}
      className={`
        border-b border-border absolute w-full cursor-pointer hover:bg-primary/5 transition-colors
        ${isWeekend || isHoliday ? "bg-muted/20" : ""}
        ${isToday ? "bg-blue-50/50" : ""}
        ${isFirstOfMonth ? "border-t-2 border-t-foreground/20" : ""}
        ${isOver ? "bg-primary/10" : ""}
      `}
      style={{
        top: `${index * rowHeight}px`,
        height: `${rowHeight}px`,
      }}
    />
  );
}

export function DeliverableSchedulePage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const location = useLocation();
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedDeliverableForSchedule, setSelectedDeliverableForSchedule] = useState<string | null>(null);
  const [dateChangeConfirmModalOpen, setDateChangeConfirmModalOpen] = useState(false);
  const [pendingDateChange, setPendingDateChange] = useState<{
    ballId: string;
    newStartDate: string;
  } | null>(null);
  const [rowHeight, setRowHeight] = useState(40);
  const [editingBallId, setEditingBallId] = useState<string | null>(null);

  useEffect(() => {
    const state = location.state as { scrollToBallId?: string } | null;
    if (state?.scrollToBallId) {
      setTimeout(() => {
        const ballElement = document.getElementById(`ball-${state.scrollToBallId}`);
        if (ballElement) {
          ballElement.scrollIntoView({ behavior: "smooth", block: "center" });
          // Clear the state after scrolling
          window.history.replaceState({}, document.title);
        }
      }, 100);
    }
  }, [location.state]);

  const mockDeliverables = [
    { id: "1", name: "LPA（ランディングページA）" },
    { id: "2", name: "LPB（ランディングページB）" },
    { id: "3", name: "LPC（ランディングページC）" },
  ];

  const [selectedDeliverableId, setSelectedDeliverableId] = useState("all");

  const mockParticipants = [
    { id: "1", name: "田中 太郎", organization: "制作会社A", type: "production" as const },
    { id: "2", name: "佐藤 花子", organization: "制作会社A", type: "production" as const },
    { id: "3", name: "鈴木 次郎", organization: "クライアントB", type: "client" as const },
  ];

  const [balls, setBalls] = useState<Ball[]>([
    // LPA
    { id: "1", name: "構成作成", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-04-15", endDate: "2026-05-02", status: "ready", ballHolder: "田中 太郎", deliverableId: "1", category: "wireframe", nextBallId: "2" },
    { id: "2", name: "お戻し", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-05-03", endDate: "2026-05-05", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "1", category: "review", nextBallId: "3" },
    { id: "3", name: "修正", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-05-06", endDate: "2026-05-08", status: "ready", ballHolder: "田中 太郎", deliverableId: "1", category: "wireframe", nextBallId: "4" },
    { id: "4", name: "お戻し", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-05-09", endDate: "2026-05-10", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "1", category: "review", nextBallId: "5" },
    { id: "5", name: "デザイン", from: "佐藤 花子", to: "鈴木 次郎", startDate: "2026-05-11", endDate: "2026-05-25", status: "ready", ballHolder: "佐藤 花子", deliverableId: "1", category: "design", nextBallId: "6" },
    { id: "6", name: "お戻し", from: "鈴木 次郎", to: "佐藤 花子", startDate: "2026-05-26", endDate: "2026-05-28", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "1", category: "review", nextBallId: "7" },
    { id: "7", name: "修正", from: "佐藤 花子", to: "鈴木 次郎", startDate: "2026-05-29", endDate: "2026-06-02", status: "ready", ballHolder: "佐藤 花子", deliverableId: "1", category: "design", nextBallId: "8" },
    { id: "8", name: "お戻し", from: "鈴木 次郎", to: "佐藤 花子", startDate: "2026-06-03", endDate: "2026-06-04", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "1", category: "review", nextBallId: "9" },
    { id: "9", name: "デザイン確定", from: "佐藤 花子", to: "田中 太郎", startDate: "2026-06-05", endDate: "2026-06-06", status: "ready", ballHolder: "佐藤 花子", deliverableId: "1", category: "design", nextBallId: "10" },
    { id: "10", name: "実装", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-06-07", endDate: "2026-06-26", status: "ready", ballHolder: "田中 太郎", deliverableId: "1", category: "coding", nextBallId: "11" },
    { id: "11", name: "プレビュー", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-06-27", endDate: "2026-06-28", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "1", category: "review", nextBallId: "12" },
    { id: "12", name: "調整", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-06-29", endDate: "2026-06-30", status: "ready", ballHolder: "田中 太郎", deliverableId: "1", category: "coding", nextBallId: "13" },
    { id: "13", name: "納品", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-07-01", endDate: "2026-07-02", status: "ready", ballHolder: "田中 太郎", deliverableId: "1", category: "other", nextBallId: "14" },
    { id: "14", name: "公開", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-07-03", endDate: "2026-07-04", status: "ready", ballHolder: "鈴木 次郎", deliverableId: "1", category: "other" },

    // LPB
    { id: "15", name: "構成作成", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-05-10", endDate: "2026-05-20", status: "ready", ballHolder: "田中 太郎", deliverableId: "2", category: "wireframe", nextBallId: "16" },
    { id: "16", name: "お戻し", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-05-21", endDate: "2026-05-25", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "2", category: "review", nextBallId: "17" },
    { id: "17", name: "修正", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-05-26", endDate: "2026-05-27", status: "ready", ballHolder: "田中 太郎", deliverableId: "2", category: "wireframe", nextBallId: "18" },
    { id: "18", name: "構成確定", from: "鈴木 次郎", to: "佐藤 花子", startDate: "2026-05-28", endDate: "2026-05-29", status: "ready", ballHolder: "鈴木 次郎", deliverableId: "2", category: "wireframe", nextBallId: "19" },
    { id: "19", name: "デザイン", from: "佐藤 花子", to: "鈴木 次郎", startDate: "2026-05-30", endDate: "2026-06-10", status: "ready", ballHolder: "佐藤 花子", deliverableId: "2", category: "design", nextBallId: "20" },
    { id: "20", name: "お戻し", from: "鈴木 次郎", to: "佐藤 花子", startDate: "2026-06-11", endDate: "2026-06-12", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "2", category: "review", nextBallId: "21" },
    { id: "21", name: "修正", from: "佐藤 花子", to: "鈴木 次郎", startDate: "2026-06-13", endDate: "2026-06-16", status: "ready", ballHolder: "佐藤 花子", deliverableId: "2", category: "design", nextBallId: "22" },
    { id: "22", name: "デザイン確定", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-06-17", endDate: "2026-06-18", status: "ready", ballHolder: "鈴木 次郎", deliverableId: "2", category: "design", nextBallId: "23" },
    { id: "23", name: "実装", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-06-19", endDate: "2026-07-09", status: "ready", ballHolder: "田中 太郎", deliverableId: "2", category: "coding", nextBallId: "24" },
    { id: "24", name: "プレビュー", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-07-10", endDate: "2026-07-11", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "2", category: "review", nextBallId: "25" },
    { id: "25", name: "調整", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-07-12", endDate: "2026-07-13", status: "ready", ballHolder: "田中 太郎", deliverableId: "2", category: "coding", nextBallId: "26" },
    { id: "26", name: "納品", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-07-14", endDate: "2026-07-15", status: "ready", ballHolder: "田中 太郎", deliverableId: "2", category: "other", nextBallId: "27" },
    { id: "27", name: "公開", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-07-16", endDate: "2026-07-17", status: "ready", ballHolder: "鈴木 次郎", deliverableId: "2", category: "other" },

    // LPC
    { id: "28", name: "構成作成", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-05-15", endDate: "2026-05-28", status: "ready", ballHolder: "田中 太郎", deliverableId: "3", category: "wireframe", nextBallId: "29" },
    { id: "29", name: "お戻し", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-05-29", endDate: "2026-06-01", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "3", category: "review", nextBallId: "30" },
    { id: "30", name: "修正", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-06-02", endDate: "2026-06-03", status: "ready", ballHolder: "田中 太郎", deliverableId: "3", category: "wireframe", nextBallId: "31" },
    { id: "31", name: "構成確定", from: "鈴木 次郎", to: "佐藤 花子", startDate: "2026-06-04", endDate: "2026-06-06", status: "ready", ballHolder: "鈴木 次郎", deliverableId: "3", category: "wireframe", nextBallId: "32" },
    { id: "32", name: "デザイン", from: "佐藤 花子", to: "鈴木 次郎", startDate: "2026-06-07", endDate: "2026-06-20", status: "ready", ballHolder: "佐藤 花子", deliverableId: "3", category: "design", nextBallId: "33" },
    { id: "33", name: "お戻し", from: "鈴木 次郎", to: "佐藤 花子", startDate: "2026-06-21", endDate: "2026-06-22", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "3", category: "review", nextBallId: "34" },
    { id: "34", name: "修正", from: "佐藤 花子", to: "鈴木 次郎", startDate: "2026-06-23", endDate: "2026-06-26", status: "ready", ballHolder: "佐藤 花子", deliverableId: "3", category: "design", nextBallId: "35" },
    { id: "35", name: "デザイン確定", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-06-27", endDate: "2026-06-28", status: "ready", ballHolder: "鈴木 次郎", deliverableId: "3", category: "design", nextBallId: "36" },
    { id: "36", name: "実装", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-06-29", endDate: "2026-07-19", status: "ready", ballHolder: "田中 太郎", deliverableId: "3", category: "coding", nextBallId: "37" },
    { id: "37", name: "プレビュー", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-07-20", endDate: "2026-07-21", status: "tossed", ballHolder: "鈴木 次郎", deliverableId: "3", category: "review", nextBallId: "38" },
    { id: "38", name: "調整", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-07-22", endDate: "2026-07-23", status: "ready", ballHolder: "田中 太郎", deliverableId: "3", category: "coding", nextBallId: "39" },
    { id: "39", name: "納品", from: "田中 太郎", to: "鈴木 次郎", startDate: "2026-07-24", endDate: "2026-07-25", status: "ready", ballHolder: "田中 太郎", deliverableId: "3", category: "other", nextBallId: "40" },
    { id: "40", name: "公開", from: "鈴木 次郎", to: "田中 太郎", startDate: "2026-07-26", endDate: "2026-07-27", status: "ready", ballHolder: "鈴木 次郎", deliverableId: "3", category: "other" },
  ]);

  const formatDate = (date: Date) => {
    return date.toISOString().split("T")[0];
  };

  const startDate = new Date("2026-04-01");
  const endDate = new Date("2026-08-31");
  const dateList: Date[] = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dateList.push(new Date(d));
  }

  const japaneseHolidays2026 = new Set([
    "2026-01-01",
    "2026-01-12",
    "2026-02-11",
    "2026-03-20",
    "2026-04-29",
    "2026-05-03",
    "2026-05-04",
    "2026-05-05",
    "2026-07-20",
    "2026-08-11",
    "2026-09-21",
    "2026-09-22",
    "2026-10-12",
    "2026-11-03",
    "2026-11-23",
  ]);

  const isWeekend = (date: Date) => {
    const day = date.getDay();
    return day === 0 || day === 6;
  };

  const isHoliday = (date: Date) => {
    return japaneseHolidays2026.has(formatDate(date));
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return formatDate(date) === formatDate(today);
  };

  const isFirstOfMonth = (date: Date) => {
    return date.getDate() === 1;
  };

  const calculateBallPosition = (ball: Ball) => {
    const start = new Date(ball.startDate);
    const end = new Date(ball.endDate);
    const daysSinceStart = Math.floor(
      (start.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const duration =
      Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return {
      top: daysSinceStart * rowHeight,
      height: duration * rowHeight,
    };
  };

  const assignLanes = (ballsForDeliverable: Ball[]) => {
    const lanes: Ball[][] = [];

    ballsForDeliverable.forEach((ball) => {
      const ballStart = new Date(ball.startDate).getTime();
      const ballEnd = new Date(ball.endDate).getTime();

      let assignedLane = -1;
      for (let i = 0; i < lanes.length; i++) {
        const hasOverlap = lanes[i].some((existingBall) => {
          const existingStart = new Date(existingBall.startDate).getTime();
          const existingEnd = new Date(existingBall.endDate).getTime();
          return !(ballEnd < existingStart || ballStart > existingEnd);
        });

        if (!hasOverlap) {
          assignedLane = i;
          break;
        }
      }

      if (assignedLane === -1) {
        lanes.push([ball]);
      } else {
        lanes[assignedLane].push(ball);
      }
    });

    const ballLaneMap = new Map<string, number>();
    lanes.forEach((lane, laneIndex) => {
      lane.forEach((ball) => {
        ballLaneMap.set(ball.id, laneIndex);
      });
    });

    return { ballLaneMap, totalLanes: lanes.length };
  };

  const handleDateClick = (date: string, deliverableId: string) => {
    const tempBallId = `temp-${Date.now()}`;
    const tempBall: Ball = {
      id: tempBallId,
      name: "",
      from: "",
      to: "",
      startDate: date,
      endDate: date,
      status: "ready",
      ballHolder: "",
      deliverableId: deliverableId,
      category: "other",
      isTemporary: true,
    };

    setBalls([...balls, tempBall]);
    setSelectedDate(date);
    setSelectedDeliverableForSchedule(deliverableId);
    setEditingBallId(tempBallId);
    setScheduleModalOpen(true);
  };

  const handleBallClick = (ball: Ball) => {
    if (ball.isTemporary) {
      return;
    }
    setEditingBallId(ball.id);
    setSelectedDate(ball.startDate);
    setSelectedDeliverableForSchedule(ball.deliverableId);
    setScheduleModalOpen(true);
  };

  const handleCreateBall = (
    ballData: Omit<Ball, "id" | "status" | "ballHolder" | "deliverableId">
  ) => {
    if (editingBallId) {
      const existingBall = balls.find((b) => b.id === editingBallId);

      if (existingBall?.isTemporary) {
        setBalls(
          balls.map((b) =>
            b.id === editingBallId
              ? {
                  ...ballData,
                  id: Date.now().toString(),
                  status: "ready" as const,
                  ballHolder: ballData.from,
                  deliverableId: selectedDeliverableForSchedule || (selectedDeliverableId === "all" ? "1" : selectedDeliverableId),
                  isTemporary: false,
                }
              : b
          )
        );
      } else {
        setBalls(
          balls.map((b) =>
            b.id === editingBallId
              ? {
                  ...b,
                  ...ballData,
                  ballHolder: ballData.from,
                }
              : b
          )
        );
      }
    } else {
      const newBall: Ball = {
        ...ballData,
        id: Date.now().toString(),
        status: "ready",
        ballHolder: ballData.from,
        deliverableId: selectedDeliverableForSchedule || (selectedDeliverableId === "all" ? "1" : selectedDeliverableId),
      };
      setBalls([...balls, newBall]);
    }

    setScheduleModalOpen(false);
    setSelectedDeliverableForSchedule(null);
    setEditingBallId(null);
  };

  const handleBallResize = (ballId: string, newStartDate: string, newEndDate: string) => {
    setBalls(
      balls.map((b) =>
        b.id === ballId
          ? { ...b, startDate: newStartDate, endDate: newEndDate }
          : b
      )
    );
  };

  const handleModalClose = () => {
    if (editingBallId) {
      const editingBall = balls.find((b) => b.id === editingBallId);
      if (editingBall?.isTemporary) {
        setBalls(balls.filter((b) => b.id !== editingBallId));
      }
    }
    setScheduleModalOpen(false);
    setSelectedDeliverableForSchedule(null);
    setEditingBallId(null);
  };

  const handleToss = (ballId: string) => {
    const currentBall = balls.find((b) => b.id === ballId);
    if (!currentBall) return;

    setBalls(
      balls.map((ball) => {
        if (ball.id === ballId) {
          return { ...ball, status: "completed" as const, ballHolder: ball.to };
        }
        if (currentBall.nextBallId && ball.id === currentBall.nextBallId) {
          return { ...ball, status: "ready" as const };
        }
        return ball;
      })
    );
    setScheduleModalOpen(false);
    setSelectedDeliverableForSchedule(null);
    setEditingBallId(null);
  };

  const handleDelete = (ballId: string) => {
    setBalls(balls.filter((ball) => ball.id !== ballId));
    setScheduleModalOpen(false);
    setSelectedDeliverableForSchedule(null);
    setEditingBallId(null);
  };

  const handleBallDrop = (ballId: string, newStartDate: string) => {
    const ball = balls.find((b) => b.id === ballId);
    if (!ball || ball.startDate === newStartDate) return;

    // For temporary balls (being created), update immediately without confirmation
    if (ball.isTemporary) {
      const originalStart = new Date(ball.startDate);
      const originalEnd = new Date(ball.endDate);
      const duration = Math.floor(
        (originalEnd.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24)
      );

      const newStart = new Date(newStartDate);
      const newEnd = new Date(newStart);
      newEnd.setDate(newEnd.getDate() + duration);

      setBalls(
        balls.map((b) =>
          b.id === ballId
            ? {
                ...b,
                startDate: formatDate(newStart),
                endDate: formatDate(newEnd),
              }
            : b
        )
      );
      return;
    }

    setPendingDateChange({ ballId, newStartDate });
    setDateChangeConfirmModalOpen(true);
  };

  const handleDateChangeConfirm = (moveSubsequent: boolean) => {
    if (!pendingDateChange) return;

    const { ballId, newStartDate } = pendingDateChange;
    const ball = balls.find((b) => b.id === ballId);
    if (!ball) return;

    const originalStart = new Date(ball.startDate);
    const originalEnd = new Date(ball.endDate);
    const duration = Math.floor(
      (originalEnd.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24)
    );

    const newStart = new Date(newStartDate);
    const newEnd = new Date(newStart);
    newEnd.setDate(newEnd.getDate() + duration);

    const daysDiff = Math.floor(
      (newStart.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (moveSubsequent && daysDiff !== 0) {
      const subsequentBalls = balls.filter(
        (b) =>
          b.deliverableId === ball.deliverableId &&
          new Date(b.startDate) >= originalEnd
      );

      setBalls(
        balls.map((b) => {
          if (b.id === ballId) {
            return {
              ...b,
              startDate: formatDate(newStart),
              endDate: formatDate(newEnd),
            };
          }

          if (subsequentBalls.some((sb) => sb.id === b.id)) {
            const bStart = new Date(b.startDate);
            const bEnd = new Date(b.endDate);
            bStart.setDate(bStart.getDate() + daysDiff);
            bEnd.setDate(bEnd.getDate() + daysDiff);
            return {
              ...b,
              startDate: formatDate(bStart),
              endDate: formatDate(bEnd),
            };
          }

          return b;
        })
      );
    } else {
      setBalls(
        balls.map((b) =>
          b.id === ballId
            ? {
                ...b,
                startDate: formatDate(newStart),
                endDate: formatDate(newEnd),
              }
            : b
        )
      );
    }

    setDateChangeConfirmModalOpen(false);
    setPendingDateChange(null);
  };

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="bg-white border-b border-border sticky top-0 z-30">
        <div className="px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1>制作物:</h1>
                  <select
                    value={selectedDeliverableId}
                    onChange={(e) => setSelectedDeliverableId(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="all">全て</option>
                    {mockDeliverables.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-muted-foreground">
                  プロジェクト: ECサイトリニューアル
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate(`/projects/${projectId}/members`)}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-md hover:bg-accent transition-colors"
              >
                <Users className="w-4 h-4" />
                メンバービュー
              </button>
              <button
                onClick={() => navigate(`/projects/${projectId}/edit`)}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-md hover:bg-accent transition-colors"
              >
                <Settings className="w-4 h-4" />
                プロジェクト編集
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="bg-white border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-200px)]">
            <div className="flex">
              <div className="flex flex-col sticky left-0 z-20 bg-white border-r border-border">
                <div className="border-b border-border bg-muted px-4 py-3 font-medium min-w-[120px] h-[60px] flex items-center sticky top-0 z-30">
                  日付
                </div>
                {dateList.map((date, index) => (
                  <div
                    key={index}
                    className={`
                      border-b border-border px-4 py-2 font-medium min-w-[120px]
                      ${isWeekend(date) || isHoliday(date) ? "bg-muted/20" : "bg-white"}
                      ${isToday(date) ? "bg-blue-50/50" : ""}
                      ${isFirstOfMonth(date) ? "border-t-2 border-t-foreground/20" : ""}
                    `}
                    style={{ height: `${rowHeight}px` }}
                  >
                    <div className="flex items-center gap-2 h-full">
                      <span className="text-sm">{date.getFullYear()}/{date.getMonth() + 1}/{date.getDate()}</span>
                      <span
                        className={`
                          text-sm
                          ${
                            date.getDay() === 0 || isHoliday(date)
                              ? "text-destructive"
                              : date.getDay() === 6
                              ? "text-blue-600"
                              : "text-muted-foreground"
                          }
                        `}
                      >
                        {["日", "月", "火", "水", "木", "金", "土"][date.getDay()]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-1">
                {(selectedDeliverableId === "all"
                  ? mockDeliverables
                  : mockDeliverables.filter((d) => d.id === selectedDeliverableId)
                ).map((deliverable) => {
                  const deliverableBalls = balls.filter(
                    (b) => b.deliverableId === deliverable.id
                  );

                  const today = new Date();
                  today.setHours(0, 0, 0, 0);

                  const currentBallHolders = deliverableBalls
                    .filter((ball) => {
                      const startDate = new Date(ball.startDate);
                      const endDate = new Date(ball.endDate);
                      startDate.setHours(0, 0, 0, 0);
                      endDate.setHours(0, 0, 0, 0);
                      return startDate <= today && endDate >= today;
                    })
                    .map((ball) => ball.ballHolder);

                  const uniqueHolders = Array.from(new Set(currentBallHolders));

                  const { ballLaneMap, totalLanes } = assignLanes(deliverableBalls);
                  const LANE_WIDTH = 260;
                  const columnWidth = Math.max(300, totalLanes * LANE_WIDTH);

                  return (
                    <div
                      key={deliverable.id}
                      className="flex flex-col border-r border-border"
                      style={{ minWidth: `${columnWidth}px` }}
                    >
                      <div className="border-b border-border bg-muted px-4 py-3 font-medium h-[60px] flex items-center justify-between sticky top-0 z-20">
                        <div className="flex-1">
                          <div className="font-medium mb-1">{deliverable.name}</div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{deliverableBalls.length}件の予定</span>
                            {uniqueHolders.length > 0 && (
                              <>
                                <span>•</span>
                                <span className="font-medium text-primary">
                                  Ball Holder: {uniqueHolders.join(", ")}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div
                        className="relative flex-1"
                        style={{ height: `${dateList.length * rowHeight}px` }}
                      >
                        {dateList.map((date, index) => (
                          <DroppableDateRow
                            key={index}
                            date={date}
                            index={index}
                            rowHeight={rowHeight}
                            deliverableId={deliverable.id}
                            onDrop={handleBallDrop}
                            onClick={handleDateClick}
                            isWeekend={isWeekend(date)}
                            isHoliday={isHoliday(date)}
                            isToday={isToday(date)}
                            isFirstOfMonth={isFirstOfMonth(date)}
                          />
                        ))}

                        {deliverableBalls.map((ball) => {
                          const position = calculateBallPosition(ball);
                          const lane = ballLaneMap.get(ball.id) || 0;

                          return (
                            <DraggableBall
                              key={ball.id}
                              ball={ball}
                              position={position}
                              lane={lane}
                              laneWidth={LANE_WIDTH}
                              rowHeight={rowHeight}
                              startDate={startDate}
                              onClick={handleBallClick}
                              onResize={handleBallResize}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </main>

      {scheduleModalOpen && (
        <ScheduleModal
          date={selectedDate || ""}
          participants={mockParticipants}
          availableBalls={balls
            .filter((b) => b.deliverableId === (selectedDeliverableForSchedule || selectedDeliverableId) && !b.isTemporary)
            .map((b) => ({ id: b.id, name: b.name, deliverableId: b.deliverableId }))}
          editingBall={
            editingBallId
              ? balls.find((b) => b.id === editingBallId)
              : undefined
          }
          onClose={handleModalClose}
          onCreate={handleCreateBall}
          onUpdate={(ballId, updates) => {
            setBalls(
              balls.map((b) =>
                b.id === ballId
                  ? {
                      ...b,
                      ...updates,
                      ballHolder: updates.from,
                    }
                  : b
              )
            );
            setScheduleModalOpen(false);
            setSelectedDeliverableForSchedule(null);
            setEditingBallId(null);
          }}
          onLiveUpdate={(updates) => {
            if (editingBallId) {
              setBalls(
                balls.map((b) =>
                  b.id === editingBallId
                    ? {
                        ...b,
                        ...updates,
                        ballHolder: updates.from || b.ballHolder,
                      }
                    : b
                )
              );
            }
          }}
          onToss={handleToss}
          onDelete={handleDelete}
        />
      )}

      {dateChangeConfirmModalOpen && pendingDateChange && (
        <DateChangeConfirmModal
          ballName={balls.find((b) => b.id === pendingDateChange.ballId)?.name || ""}
          onClose={() => {
            setDateChangeConfirmModalOpen(false);
            setPendingDateChange(null);
          }}
          onConfirm={handleDateChangeConfirm}
        />
      )}

      <div className="fixed bottom-6 right-6 bg-white border border-border rounded-lg shadow-lg p-4 z-40">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRowHeight(Math.max(20, rowHeight - 5))}
            className="p-1 hover:bg-accent rounded transition-colors"
            aria-label="縮小"
          >
            <ZoomOut className="w-4 h-4 text-muted-foreground" />
          </button>
          <input
            type="range"
            min="20"
            max="80"
            step="5"
            value={rowHeight}
            onChange={(e) => setRowHeight(Number(e.target.value))}
            className="w-32 accent-primary"
          />
          <button
            onClick={() => setRowHeight(Math.min(80, rowHeight + 5))}
            className="p-1 hover:bg-accent rounded transition-colors"
            aria-label="拡大"
          >
            <ZoomIn className="w-4 h-4 text-muted-foreground" />
          </button>
          <span className="text-sm text-muted-foreground ml-2 min-w-[3rem]">
            {rowHeight}px
          </span>
        </div>
      </div>
    </div>
  );
}
