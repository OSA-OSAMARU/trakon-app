import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

import { cn } from '@/components/ui/utils';

import type { DayTone } from './dayTones';

/** 日付軸の幅 px (Figma node 10:3)。 */
export const DATE_AXIS_WIDTH = 96;

/** 列ヘッダーの高さ px (Figma node 10:3 / 10:5)。 */
export const COLUMN_HEADER_HEIGHT = 72;

/**
 * 行高に応じた日付の見せ方。
 *
 * Figma は行高 56px 固定で日を 20px の大きな数字にしているが、実装には
 * 20〜80px のズームがある。小さい行高では数字が収まらないため 3 段階に落とす。
 */
function dateLayout(rowHeight: number): 'full' | 'compact' | 'minimal' {
  if (rowHeight >= 44) return 'full';
  if (rowHeight >= 30) return 'compact';
  return 'minimal';
}

/** 左端に固定表示する日付軸 (縦軸)。 */
export function DateAxis({
  days,
  dayTones,
  rowHeight,
  totalHeight,
}: {
  days: Date[];
  dayTones: DayTone[];
  rowHeight: number;
  totalHeight: number;
}) {
  const layout = dateLayout(rowHeight);
  return (
    <div
      className="border-grid-border sticky left-0 z-30 shrink-0 border-r bg-background"
      style={{ width: DATE_AXIS_WIDTH }}
    >
      <div
        className="border-grid-border bg-surface-subtle sticky top-0 z-10 flex items-center border-b px-[18px]"
        style={{ height: COLUMN_HEADER_HEIGHT }}
      >
        <span className="text-text-tertiary text-tiny font-medium">日付</span>
      </div>
      <div className="relative" style={{ height: totalHeight }}>
        {days.map((d, i) => {
          const t = dayTones[i]!;
          return (
            <div
              key={i}
              className={cn(
                'border-grid-border absolute right-0 left-0 flex items-center gap-1 border-b pr-[22px] pl-[18px]',
                t.tone,
                t.text,
                t.first && 'border-t-grid-border border-t-2',
              )}
              style={{ top: i * rowHeight, height: rowHeight }}
            >
              {/* 本日マーカー: 行の左端に立てる 4px の帯 (Figma node 10:102) */}
              {t.today && <span className="bg-today-marker absolute inset-y-0 left-0 w-1" aria-hidden />}
              {/* 月の切り替わりに月名を添える (Figma node 10:115) */}
              {t.first && layout !== 'minimal' && (
                <span className="text-text-secondary absolute top-0.5 left-[18px] text-mini font-bold">
                  {format(d, 'M月')}
                </span>
              )}
              <span
                className={cn(
                  'flex-1 text-right font-bold tabular-nums',
                  layout === 'full' ? 'text-xl' : layout === 'compact' ? 'text-sm' : 'text-tiny',
                )}
              >
                {format(d, 'd')}
              </span>
              {layout !== 'minimal' && (
                <span className="w-5 text-center text-tiny font-medium">
                  {format(d, 'EEEEE', { locale: ja })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
