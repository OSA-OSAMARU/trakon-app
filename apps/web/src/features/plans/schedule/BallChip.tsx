import { format, parseISO } from 'date-fns';
import { CheckCircle2, Copy, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/utils';

import type { Plan } from '../api';
import { CATEGORY_STYLE } from '../planTheme';
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
 * スケジュール上の 1 予定 (ボール)。
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
  const style = CATEGORY_STYLE[plan.category];
  const completed = plan.status === 'completed';
  const tossed = plan.ballState === 'tossed';
  const overdue = isOverdue(plan, today);
  const active = isActiveNow(plan, today);
  const editing = mode === 'edit';
  /** 期間・後続を編集できるか (完了・取消は不可) */
  const editable = editing && plan.status === 'active';
  const clickable = !!onActivate;

  // TOSS 済みは「相手に渡し終えた＝自分の作業は完了」をグレーで表現
  const cardClass = completed
    ? 'border-slate-200 bg-slate-100/80 text-slate-500 opacity-60'
    : overdue
      ? 'border-red-400 bg-red-50 text-red-700'
      : tossed
        ? 'border-slate-300 bg-slate-100 text-slate-600'
        : cn(style.bg, style.border, style.text);

  // リング表現は排他にして色の衝突を避ける (紐づけ対象 > チェーン > 進行中)
  const ringClass = linkTarget
    ? 'ring-2 ring-primary ring-offset-1'
    : inChain
      ? 'ring-2 ring-sky-500'
      : active && !completed
        ? 'ring-2 ring-primary/40'
        : undefined;

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
        'group absolute overflow-hidden rounded-md border px-2 py-1 text-xs shadow-sm',
        cardClass,
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
      {/* リサイズハンドル (上)。単日/短期の予定 (mini) でも掴んで期間変更できるよう
          tier に依らず表示する (#113)。 */}
      {editable && (
        <div
          onPointerDown={(e) => onPointerDownBall?.(e, 'resize-top')}
          className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize"
          aria-hidden
        />
      )}

      {/* 複製ボタン (ホバー表示 #51)。カード右上に重ねる。 */}
      {editing && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onCopy?.();
          }}
          disabled={copying}
          className="absolute right-0.5 top-0.5 z-10 rounded bg-background/80 p-0.5 text-foreground/70 opacity-0 shadow-sm transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          aria-label="複製"
          title="複製"
        >
          {copying ? <Loader2 className="size-3 animate-spin" /> : <Copy className="size-3" />}
        </button>
      )}

      {/* 先行コネクトの受け口 (上端中央): 先行予定がある場合に常時表示する線の終点アンカー */}
      {hasPredecessor && (
        <div
          className="pointer-events-none absolute left-1/2 top-0 z-10 size-2.5 -translate-x-1/2 rounded-full border-2 border-background bg-sky-500 shadow"
          aria-hidden
        />
      )}

      <div className="flex items-center justify-between gap-1">
        <span className="line-clamp-1 font-medium">{plan.title}</span>
        {completed && <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />}
      </div>

      {tier !== 'mini' && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] opacity-90">
          <span className="rounded bg-black/5 px-1">{style.label}</span>
          <span className="line-clamp-1">
            {format(parseISO(start), 'M/d')}
            {start !== end && `〜${format(parseISO(end), 'M/d')}`}
          </span>
        </div>
      )}

      {tier === 'normal' && (
        <div className="mt-1 border-t border-current/10 pt-1 text-[10px] leading-tight">
          <div className="flex items-center gap-1">
            <span className="opacity-60">実施者</span>
            <span className="line-clamp-1 font-medium">{plan.executor?.name ?? '—'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="opacity-60">{plan.approver ? '承認者' : '進行責任者'}</span>
            <span className="line-clamp-1 font-medium">
              {(plan.approver ?? plan.progressManager)?.name ?? '—'}
            </span>
            {plan.ballHolder && (
              <Badge variant="secondary" className="ml-auto px-1 py-0 text-[9px]">
                {plan.ballHolder.name}
              </Badge>
            )}
          </div>
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
            'pointer-events-none absolute bottom-0 left-1/2 z-10 size-2.5 -translate-x-1/2 rounded-full border-2 border-background bg-sky-500 shadow',
            editable && tier !== 'mini' && 'transition-opacity group-hover:opacity-0',
          )}
          aria-hidden
        />
      )}

      {/* 後続紐づけハンドル (下端中央): ドラッグして別カードに重ねると後続に設定/張り替え */}
      {editable && tier !== 'mini' && (
        <div
          onPointerDown={onPointerDownConnector}
          className="absolute bottom-0 left-1/2 z-20 size-3 -translate-x-1/2 cursor-crosshair rounded-full border-2 border-background bg-sky-500 opacity-0 shadow transition-opacity group-hover:opacity-100"
          title={hasSuccessor ? 'ドラッグして後続予定を張り替え' : 'ドラッグして後続予定に紐づけ'}
          aria-hidden
        />
      )}
    </div>
  );
}
