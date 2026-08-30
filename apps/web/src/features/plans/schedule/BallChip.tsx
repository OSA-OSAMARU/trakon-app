import { format, parseISO } from 'date-fns';
import { CalendarDays, Copy, Loader2 } from 'lucide-react';

import { cn } from '@/components/ui/utils';
import { RoleRow } from '@/components/trakon/RoleRow';
import { StatusPill } from '@/components/trakon/StatusPill';

import type { Plan } from '../api';
import { planCardStyle } from '../planTheme';
import {
  ballTier,
  chipVerticalBounds,
  dayIndex,
  isActiveNow,
  isOverdue,
  planRange,
} from '../scheduleLayout';
import type { DragState } from './types';

/**
 * スケジュール上の 1 予定 (ボール) — Figma node 11:2。
 *
 * 左の 4px ストライプ + 淡色の面でテーマ色を示し、文字色は全テーマ共通。
 * 高さ (= 期間 × 行高) に応じて表示量を 3 段階に落とす。
 *   mini    … タイトルのみ
 *   compact … ＋カテゴリ・期間・状態
 *   normal  … ＋3 役割
 *
 * mode='edit'  … 認証済みのスケジュール画面。移動 / 期間リサイズ / 複製 / 後続紐づけができる。
 * mode='view'  … 共有リンク (非会員) 画面。クリックで操作モーダルを開くだけ。
 */
export function BallChip({
  plan,
  days,
  rowHeight,
  laneWidth,
  lane,
  today,
  mode = 'view',
  drag = null,
  linkTarget = false,
  hasSuccessor = false,
  hasPredecessor = false,
  inChain = false,
  copying = false,
  onActivate,
  onCopy,
  onHoverChange,
  onPointerDownBall,
  onPointerDownConnector,
}: {
  plan: Plan;
  days: Date[];
  rowHeight: number;
  laneWidth: number;
  lane: number;
  today: Date;
  mode?: 'edit' | 'view';
  drag?: DragState | null;
  linkTarget?: boolean;
  hasSuccessor?: boolean;
  hasPredecessor?: boolean;
  inChain?: boolean;
  copying?: boolean;
  onActivate?: () => void;
  onCopy?: () => void;
  onHoverChange?: (planId: string | null) => void;
  onPointerDownBall?: (e: React.PointerEvent, mode: DragState['mode']) => void;
  onPointerDownConnector?: (e: React.PointerEvent) => void;
}) {
  const { start, end } = planRange(plan);
  let startIdx = dayIndex(days, start);
  let endIdx = dayIndex(days, end);

  // ドラッグ中のライブプレビュー
  if (drag) {
    if (drag.mode === 'move') {
      startIdx += drag.dayDelta;
      endIdx += drag.dayDelta;
    } else if (drag.mode === 'resize-top') {
      startIdx = Math.min(endIdx, startIdx + drag.dayDelta);
    } else if (drag.mode === 'resize-bottom') {
      endIdx = Math.max(startIdx, endIdx + drag.dayDelta);
    }
  }

  const { top, height } = chipVerticalBounds(startIdx, endIdx, rowHeight);
  const tier = ballTier(height);
  const theme = planCardStyle(plan.category, plan.colorTheme);
  const completed = plan.status === 'completed';
  const overdue = isOverdue(plan, today);
  const active = isActiveNow(plan, today);
  const editing = mode === 'edit';
  /** 期間・後続を編集できるか (完了・取消は不可) */
  const editable = editing && plan.status === 'active';
  const clickable = !!onActivate;

  // 配色ポリシー (Figma node 54:2): 色は「状態」ではなく、ユーザーがスケジュールを
  // 視覚整理するために選ぶもの。したがって状態でテーマ色を差し替えない。
  //   状態    → ステータス pill で伝える
  //   完了    → テーマ色のまま少し退かせる (済みであることは pill と併せて分かる)
  //   期限超過→ テーマ色は保ったまま赤い枠で警告する (ダッシュボードの扱いと揃える)
  const surfaceClass = cn(theme.surface, 'text-plan-foreground', completed && 'opacity-70');
  const borderClass = overdue ? 'border-danger' : theme.border;
  const stripeClass = theme.stripe;

  // リング表現は排他にして色の衝突を避ける (紐づけ対象 > チェーン > 進行中)
  const ringClass = linkTarget
    ? 'ring-2 ring-ring ring-offset-1'
    : inChain
      ? 'ring-2 ring-toss-line'
      : overdue
        ? 'ring-1 ring-danger'
        : active && !completed
          ? 'ring-2 ring-ring/40'
          : undefined;

  const statusStatus = completed ? 'completed' : plan.ballState;

  // 単日のように背の低いカードでは、Figma (node 11:2) の上下パディング 11/12px を
  // 入れるとタイトル 1 行 (14px * 1.5 = 20px) が収まらず、下端へ押し出されて見える。
  // 収まらない高さのときだけパディングを畳み、タイトルを上下中央に置く。
  // pb-[0.11em] は Noto Sans JP の行ボックス非対称の補正 (ui/button.tsx と同じ理由)。
  const tight = height < 11 + 20 + 12;

  return (
    <div
      {...(clickable
        ? {
            role: 'button' as const,
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivate(); // キーボードでは詳細を開く (移動はマウスのみ)
              }
            },
            // 編集モードでは pointerup 時にクリック相当を判定するため onClick は使わない
            ...(editing ? {} : { onClick: onActivate }),
          }
        : {})}
      data-plan-id={plan.id}
      onPointerDown={editing ? (e) => onPointerDownBall?.(e, 'move') : undefined}
      onPointerEnter={editing ? () => onHoverChange?.(plan.id) : undefined}
      onPointerLeave={editing ? () => onHoverChange?.(null) : undefined}
      className={cn(
        'shadow-card group absolute flex flex-col overflow-hidden rounded-lg border px-[15px]',
        tight ? 'justify-center pb-[0.11em]' : 'pt-[11px] pb-[12px]',
        surfaceClass,
        borderClass,
        ringClass,
        drag?.mode === 'move' && 'opacity-70',
        editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        !editing && clickable && 'hover:brightness-95',
      )}
      style={{
        top,
        height,
        left: lane * laneWidth + 6,
        width: laneWidth - 12,
      }}
    >
      {/* テーマ色の左ストライプ (Figma node 11:3) */}
      <span className={cn('absolute inset-y-0 left-0 w-1 rounded-sm', stripeClass)} aria-hidden />

      {/* リサイズハンドル (上)。単日/短期の予定 (mini) でも掴んで期間変更できるよう
          tier に依らず表示する (#113)。 */}
      {editable && (
        <div
          onPointerDown={(e) => onPointerDownBall?.(e, 'resize-top')}
          className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize"
          aria-hidden
        />
      )}

      {/* 先行コネクトの受け口 (上端中央): 先行予定がある場合に常時表示する線の終点アンカー */}
      {hasPredecessor && (
        <div
          className="bg-toss-line pointer-events-none absolute top-0 left-1/2 z-10 size-2.5 -translate-x-1/2 rounded-full border-2 border-background shadow"
          aria-hidden
        />
      )}

      <div className="flex items-start gap-1">
        <span className="line-clamp-1 flex-1 text-sm font-bold">{plan.title}</span>
        {/* 閲覧専用では操作が無いため、Figma の「⋯」位置には何も置かない */}
        {editing && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onCopy?.();
            }}
            disabled={copying}
            className="-mt-0.5 shrink-0 rounded-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-70 hover:opacity-100 focus-visible:opacity-100"
            aria-label="複製"
            title="複製"
          >
            {copying ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
          </button>
        )}
      </div>

      {tier !== 'mini' && (
        <>
          <span className="mt-[6px] text-mini font-medium opacity-80">{theme.label}</span>
          <span className="mt-[6px] flex items-center gap-1.5 text-mini">
            <CalendarDays className="size-3.5 shrink-0 opacity-70" aria-hidden />
            {format(parseISO(start), 'M.d')}
            {start !== end && ` – ${format(parseISO(end), 'M.d')}`}
          </span>
          <div className="mt-[6px] flex justify-end">
            <StatusPill status={statusStatus} className="bg-background/70" />
          </div>
        </>
      )}

      {/* 3 役割はカード下端に寄せる (Figma node 25:2) */}
      {tier === 'normal' && (
        <div className="mt-auto flex flex-col gap-1 pt-2">
          <RoleRow role="executor" name={plan.executor?.name ?? '—'} />
          {plan.approver && <RoleRow role="approver" name={plan.approver.name} />}
          {plan.progressManager && (
            <RoleRow role="manager" name={plan.progressManager.name} />
          )}
        </div>
      )}

      {/* リサイズハンドル (下)。単日/短期の予定 (mini) でも掴んで期間変更できるよう
          tier に依らず表示する (#113)。後続紐づけハンドル (z-20) より下に置く。 */}
      {editable && (
        <div
          onPointerDown={(e) => onPointerDownBall?.(e, 'resize-bottom')}
          className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize"
          aria-hidden
        />
      )}

      {/* 後続コネクトの起点 (下端中央): 後続予定がある場合に常時表示する線の起点アンカー。
          編集可・mini以外ではホバー時に作成/張り替えハンドルへ譲る。 */}
      {hasSuccessor && (
        <div
          className={cn(
            'bg-toss-line pointer-events-none absolute bottom-0 left-1/2 z-10 size-2.5 -translate-x-1/2 rounded-full border-2 border-background shadow',
            editable && tier !== 'mini' && 'transition-opacity group-hover:opacity-0',
          )}
          aria-hidden
        />
      )}

      {/* 後続紐づけハンドル (下端中央): ドラッグして別カードに重ねると後続に設定/張り替え */}
      {editable && tier !== 'mini' && (
        <div
          onPointerDown={onPointerDownConnector}
          className="bg-toss-line absolute bottom-0 left-1/2 z-20 size-3 -translate-x-1/2 cursor-crosshair rounded-full border-2 border-background opacity-0 shadow transition-opacity group-hover:opacity-100"
          title={hasSuccessor ? 'ドラッグして後続予定を張り替え' : 'ドラッグして後続予定に紐づけ'}
          aria-hidden
        />
      )}
    </div>
  );
}
