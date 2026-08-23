import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

import { cn } from '@/components/ui/utils';

import type { DayTone } from './dayTones';

/** 日付軸の幅 px。列の sticky 位置計算と揃える。 */
export const DATE_AXIS_WIDTH = 76;

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
  return (
    <div
      className="sticky left-0 z-30 shrink-0 border-r border-border bg-background"
      style={{ width: DATE_AXIS_WIDTH }}
    >
      <div className="sticky top-0 z-10 h-16 border-b border-border bg-background" />
      <div className="relative" style={{ height: totalHeight }}>
        {days.map((d, i) => {
          const t = dayTones[i]!;
          return (
            <div
              key={i}
              className={cn(
                'absolute left-0 right-0 flex flex-col items-center justify-center border-b border-border text-xs',
                t.tone,
                t.first && 'border-t-2 border-t-foreground/20',
                t.today && 'font-semibold text-amber-700',
                t.holiday && 'text-rose-600',
              )}
              style={{ top: i * rowHeight, height: rowHeight }}
            >
              <span>{format(d, 'M/d')}</span>
              {rowHeight >= 30 && (
                <span
                  className={cn(
                    'text-[10px]',
                    t.weekend ? 'text-slate-500' : 'text-muted-foreground',
                    t.holiday && 'text-rose-500',
                  )}
                >
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
