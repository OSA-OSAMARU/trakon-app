import { format, parseISO } from 'date-fns';
import { Copy, Loader2 } from 'lucide-react';
import { PROJECT_ROLE_LABEL } from '@trakon/shared';

import { cn } from '@/components/ui/utils';
import { Avatar } from '@/components/ui/avatar';
import { MemberProfileHover } from '@/features/projects/MemberProfileCard';
import type { ProjectMember } from '@/features/projects/membersApi';

import type { MemberRef, Plan } from '../api';
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
 * スケジュール上の 1 予定 (ボール) — Figma「05 Schedule Card」node 308:90。
 *
 * 左の 6px ストライプ + 淡色の面でテーマ色を示し、文字色は全テーマ共通。
 * **カードの期間ではなく実際に確保できる高さ**で表示量を 3 段階に落とす。
 *
 *   要素          Large            Medium        Small
 *   タイトル      2 行まで         1 行          1 行
 *   工程・日付    表示             表示          —
 *   Ball Holder   Avatar+氏名+権限 Avatar+氏名   Avatar+姓
 *
 * カードに出すのは**現在の Ball Holder 1 名だけ**で、他の担当者は詳細パネルに送る。
 * FIX (完了) のときは Holder 表示を「FIX」の文字へ差し替える。
 * 進行状態のアイコンと pill はカードでは使わない (状態は詳細パネルで伝える)。
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
  memberById,
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
  /**
   * 担当者のプロフィール (#159)。渡されたときだけホバーカードを出す。
   * 共有リンク画面 (非会員) は参加者一覧を取れないので渡らず、
   * メールアドレスが漏れない形になっている。
   */
  memberById?: Map<string, ProjectMember>;
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

  // Ball Holder は常に 1 名だけ (Figma node 308:90「通常：現在の Ball Holder 1名だけを表示」)。
  // FIX したカードは保持者が居ないので、同じ場所を「FIX」の文字に差し替える。
  const holder = plan.ballHolder;
  const holderMember = holder ? memberById?.get(holder.id) : undefined;
  const holderRole = holderMember ? PROJECT_ROLE_LABEL[holderMember.roleType] : null;

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
        'shadow-card group absolute flex flex-col overflow-hidden rounded-lg border pr-[15px] pl-4',
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
      {/* テーマ色の左ストライプ (Figma「07 Calendar」node 355:132 / Category stripe 6px) */}
      <span className={cn('absolute inset-y-0 left-0 w-1.5 rounded-sm', stripeClass)} aria-hidden />

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
        <span className={cn('flex-1 text-body font-bold', tier === 'large' ? 'line-clamp-2' : 'line-clamp-1')}>
          {plan.title}
        </span>
        {/* Small はタイトルと同じ行の右端に Ball Holder を置く (Figma node 311:94) */}
        {tier === 'small' && <BallHolderTag plan={plan} holder={holder} member={holderMember} size="small" />}
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

      {/* 工程と日付は 1 行にまとめる (Figma node 321:91 / 322:91 の Meta 行) */}
      {tier !== 'small' && (
        <span className="mt-1.5 flex items-center gap-2 text-mini opacity-80">
          <span className="font-medium">{theme.label}</span>
          <span>
            {format(parseISO(start), 'M.d')}
            {start !== end && ` – ${format(parseISO(end), 'M.d')}`}
          </span>
        </span>
      )}

      {/* Ball Holder はカード下端に寄せる。Large だけ区切り線とラベルを添える */}
      {tier !== 'small' && (
        <div className="mt-auto flex flex-col pt-2">
          {tier === 'large' && (
            <>
              <span className="border-plan-foreground/15 border-t" aria-hidden />
              <span className="text-mini mt-2 font-medium tracking-wider opacity-60">
                BALL HOLDER
              </span>
            </>
          )}
          <div className="mt-1.5">
            <BallHolderTag
              plan={plan}
              holder={holder}
              member={holderMember}
              role={tier === 'large' ? holderRole : null}
              size={tier === 'large' ? 'large' : 'medium'}
            />
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
            'bg-toss-line pointer-events-none absolute bottom-0 left-1/2 z-10 size-2.5 -translate-x-1/2 rounded-full border-2 border-background shadow',
            editable && tier !== 'small' && 'transition-opacity group-hover:opacity-0',
          )}
          aria-hidden
        />
      )}

      {/* 後続紐づけハンドル (下端中央): ドラッグして別カードに重ねると後続に設定/張り替え */}
      {editable && tier !== 'small' && (
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


/** 姓だけを取り出す。「石原 美咲」→「石原」。区切りが無ければそのまま返す。 */
function surnameOf(name: string): string {
  const head = name.trim().split(/[\s\u3000]+/)[0];
  return head || name;
}

/**
 * カード上の Ball Holder 表示 (Figma node 308:90「Ball Holder / 表示ルール」)。
 *
 *   Large  … Avatar 32px + 氏名 + 権限区分
 *   Medium … Avatar 24px + 氏名
 *   Small  … Avatar 22px + 姓
 *
 * FIX したカードは保持者が居ないため、同じ場所を「FIX」の文字へ差し替える。
 * アバターはブランド色。カード上で唯一「いま誰の番か」を示す要素なので、
 * テーマ色 (ユーザーの視覚整理用) とは別系統の色で目を引かせる。
 */
function BallHolderTag({
  plan,
  holder,
  member,
  role = null,
  size,
}: {
  plan: Plan;
  holder: MemberRef | null;
  member?: ProjectMember;
  /** 権限区分のラベル。Large でのみ添える */
  role?: string | null;
  size: 'small' | 'medium' | 'large';
}) {
  const nameClass = size === 'large' ? 'text-body' : 'text-label';

  if (plan.status === 'completed') {
    return (
      <span className={cn('font-bold tracking-wide', nameClass)} title="FIX">
        FIX
      </span>
    );
  }

  if (!holder) {
    return <span className={cn('opacity-60', nameClass)}>—</span>;
  }

  const avatarSize = size === 'large' ? 'size-8' : size === 'medium' ? 'size-6' : 'size-[22px]';
  const label = size === 'small' ? surnameOf(holder.name) : holder.name;

  return (
    <MemberProfileHover member={member}>
      <span className="flex min-w-0 items-center gap-2">
        <Avatar
          name={holder.name}
          src={member?.avatarUrl}
          className={cn('bg-brand text-brand-foreground text-mini', avatarSize)}
        />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className={cn('truncate font-medium', nameClass)}>{label}</span>
          {role && <span className="text-label opacity-60">{role}</span>}
        </span>
      </span>
    </MemberProfileHover>
  );
}
