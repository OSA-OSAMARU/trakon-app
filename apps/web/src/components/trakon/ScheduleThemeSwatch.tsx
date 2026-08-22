import type * as React from 'react';

import { cn } from '@/components/ui/utils';

import { SCHEDULE_THEMES, type ScheduleThemeKey } from './scheduleTheme';

/**
 * スケジュールカラーテーマの色見本 (Figma node 54:2 のカード右上の丸)。
 * カード上のテーマ表示と、予定ごとの色選択 UI の両方で使う。
 */
type ScheduleThemeSwatchProps = React.ComponentProps<'span'> & {
  theme: ScheduleThemeKey;
  selected?: boolean;
};

export function ScheduleThemeSwatch({
  theme,
  selected,
  className,
  ...props
}: ScheduleThemeSwatchProps) {
  const t = SCHEDULE_THEMES[theme];
  return (
    <span
      data-slot="schedule-theme-swatch"
      data-theme={theme}
      title={t.label}
      className={cn(
        'inline-block size-[18px] shrink-0 rounded-full',
        t.accent,
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
        className,
      )}
      {...props}
    />
  );
}
