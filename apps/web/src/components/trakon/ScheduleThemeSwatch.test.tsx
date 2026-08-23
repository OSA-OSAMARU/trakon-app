import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { SCHEDULE_THEME_KEYS, SCHEDULE_THEME_LIST, SCHEDULE_THEME_MAP } from './scheduleTheme';
import { ScheduleThemeSwatch } from './ScheduleThemeSwatch';

describe('scheduleTheme', () => {
  it('Figma のカラーパレットと同じ 10 テーマを持つ', () => {
    expect(SCHEDULE_THEME_KEYS).toHaveLength(10);
    expect(SCHEDULE_THEME_LIST).toHaveLength(10);
  });

  it('各テーマが surface / accent のクラスを持つ', () => {
    for (const t of SCHEDULE_THEME_LIST) {
      expect(t.surface).toBe(`bg-plan-${t.key}-surface`);
      expect(t.accent).toBe(`bg-plan-${t.key}-accent`);
      expect(t.accentText).toBe(`text-plan-${t.key}-accent`);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
});

describe('ScheduleThemeSwatch', () => {
  it('テーマのアクセント色を描画する', () => {
    const { container } = render(<ScheduleThemeSwatch theme="coral" />);
    const el = container.querySelector('[data-slot="schedule-theme-swatch"]');
    expect(el?.className).toContain(SCHEDULE_THEME_MAP.coral.accent);
    expect(el?.getAttribute('title')).toBe('Coral');
  });

  it('selected のときリングが付く', () => {
    const { container } = render(<ScheduleThemeSwatch theme="blue" selected />);
    expect(container.querySelector('[data-slot="schedule-theme-swatch"]')?.className).toContain(
      'ring-2',
    );
  });
});
