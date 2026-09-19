import * as React from 'react';
import {
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  addDays,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from './utils';

/**
 * 月表示のカレンダー (#196)。
 *
 * Figma「06 Form Controls / Guide v1.0」の Calendar セクション (node `342:102`)。
 * 日付セルの状態は 4 つだけで、それぞれ**別の意味**を持つ。
 *
 *   - 既定       … 何も塗らない
 *   - 今日       … ブランド色の輪郭のみ (`border-accent`)。「いまここ」を示すだけで選択ではない
 *   - 選択中     … ブランド色で塗りつぶし + 白文字 (`bg-accent` / `text-on-accent`)
 *   - 対象外     … 淡い文字 (`text-muted`)。当月外の日と、選択できない日
 *
 * 「今日」と「選択中」を輪郭と塗りで分けているのが肝で、今日を選んでいるのか
 * 単に今日が見えているだけなのかが一目で分かる。
 *
 * 週の始まりは日曜。6 行を常に描画して、月を送っても高さが変わらないようにする
 * (高さが変わるとポップオーバーが飛び跳ねて押し間違いの元になる)。
 */
export type CalendarProps = {
  /** 選択中の日付 (`yyyy-MM-dd`)。未選択は null */
  value: string | null;
  onSelect: (date: string) => void;
  /** 選択できる下限・上限 (`yyyy-MM-dd`)。範囲外は淡色で押せなくなる */
  min?: string;
  max?: string;
  /** 「今日」として扱う日。既定は実行時の今日 (テスト・Storybook 用) */
  today?: Date;
  className?: string;
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 6 週分 (42 日) の並び。月をまたいでも常に同じ行数になる。 */
function buildGrid(month: Date): Date[] {
  const first = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function Calendar({ value, onSelect, min, max, today, className }: CalendarProps) {
  const selected = value ? parseISO(value) : null;
  const now = today ?? new Date();

  // 表示中の月。選択があればその月、無ければ今日の月から始める。
  const [month, setMonth] = React.useState<Date>(startOfMonth(selected ?? now));

  // 外から選択が変わったら (フォームのリセットなど) その月へ追従する
  React.useEffect(() => {
    if (selected) setMonth(startOfMonth(selected));
    // value 文字列の変化だけを見る (Date を依存に入れると毎描画で発火する)
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = buildGrid(month);

  const outOfRange = (d: Date) => {
    const iso = format(d, 'yyyy-MM-dd');
    return (min !== undefined && iso < min) || (max !== undefined && iso > max);
  };

  return (
    <div className={cn('w-[332px]', className)} data-slot="calendar">
      <div className="mb-2 flex items-center justify-between">
        <NavButton label="前の月" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft className="size-4" />
        </NavButton>
        {/* aria-live で月送りをスクリーンリーダーにも伝える */}
        <span aria-live="polite" className="text-body font-medium">
          {format(month, 'yyyy年M月')}
        </span>
        <NavButton label="次の月" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight className="size-4" />
        </NavButton>
      </div>

      <div className="text-text-tertiary grid grid-cols-7 text-center text-label">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1.5">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((d) => {
          const iso = format(d, 'yyyy-MM-dd');
          const isSelected = !!selected && isSameDay(d, selected);
          const isToday = isSameDay(d, now);
          const disabled = outOfRange(d);
          // 当月外と範囲外は同じ「いま選ぶ対象ではない」なので同じ淡色で出す
          const dimmed = !isSameMonth(d, month) || disabled;

          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              aria-label={format(d, 'yyyy年M月d日')}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSelected}
              onClick={() => onSelect(iso)}
              className="flex h-11 items-center justify-center"
            >
              <span
                className={cn(
                  'flex size-9 items-center justify-center rounded-full text-body transition-colors',
                  isSelected
                    ? 'bg-brand text-brand-foreground font-medium'
                    : isToday
                      ? 'border-brand text-foreground border'
                      : dimmed
                        ? 'text-text-tertiary'
                        : 'text-foreground',
                  !isSelected && !disabled && 'hover:bg-accent',
                )}
              >
                {d.getDate()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="text-text-secondary hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-md transition-colors"
    >
      {children}
    </button>
  );
}
