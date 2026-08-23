import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/components/ui/utils';

import { SCHEDULE_THEME_LIST, type ScheduleThemeKey } from './scheduleTheme';
import { ScheduleThemeSwatch } from './ScheduleThemeSwatch';

/**
 * 予定のカラーテーマを選ぶピッカー (Figma node 56:2)。
 *
 * 色は「状態」ではなく、ユーザーがスケジュールを視覚整理するために選ぶもの
 * (Figma node 54:2)。未選択のときはカテゴリ由来の既定色が使われるため、
 * 「既定に戻す」も選べるようにしている。
 */
export function ScheduleThemePicker({
  value,
  fallback,
  onChange,
  disabled,
}: {
  /** ユーザーが選んだテーマ。null なら未選択 */
  value: ScheduleThemeKey | null;
  /** 未選択のときに実際に使われるテーマ (カテゴリ由来の既定色) */
  fallback: ScheduleThemeKey;
  onChange: (v: ScheduleThemeKey | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = value ?? fallback;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label="カラーテーマを選ぶ"
        className={cn(
          'focus-visible:ring-ring/50 flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] disabled:opacity-50',
          !disabled && 'hover:bg-accent',
        )}
      >
        <ScheduleThemeSwatch theme={shown} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <div className="flex flex-col gap-3">
          <p className="text-text-secondary text-xs">
            スケジュールを見分けるための色です。状態は色では表しません。
          </p>
          <div className="grid grid-cols-5 gap-3">
            {SCHEDULE_THEME_LIST.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-label={t.label}
                title={t.label}
                onClick={() => {
                  onChange(t.key);
                  setOpen(false);
                }}
                className="focus-visible:ring-ring/50 flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
              >
                <ScheduleThemeSwatch theme={t.key} selected={value === t.key} />
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={value === null}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            カテゴリの既定色に戻す
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
