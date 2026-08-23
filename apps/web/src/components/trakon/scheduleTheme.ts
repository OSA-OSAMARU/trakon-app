import { SCHEDULE_THEMES, type ScheduleThemeKey } from '@trakon/shared';

/**
 * スケジュールカードのカラーテーマ 10 種 (Figma node 54:2)。
 *
 * 文字色は全テーマ共通 (--plan-foreground / #22211F) で、背景とのコントラストは
 * 13:1 以上を確保している。淡色の Surface に濃色の Accent を組み合わせる。
 *
 * **色は「状態」を表すものではなく、ユーザーがスケジュールを視覚整理するために
 * 選ぶもの**（Figma 54:2 の明記事項）。状態はステータス pill とボール保持者の表示で伝える。
 *
 * 現時点では予定のカテゴリから既定テーマを導出している（features/plans/planTheme.ts）。
 * 将来的に予定ごとのユーザー選択へ移行する。
 */

// キーの定義は FE/BE/DB で共有するため packages/shared に置いている。
export { SCHEDULE_THEMES as SCHEDULE_THEME_KEYS, type ScheduleThemeKey };

export type ScheduleTheme = {
  key: ScheduleThemeKey;
  label: string;
  /** 淡色の面 */
  surface: string;
  /** 濃色のアクセント（左ストライプ・スウォッチ・強調文字） */
  accent: string;
  /** アクセントを枠線に使う場合 */
  border: string;
  /** アクセントを文字色に使う場合 */
  accentText: string;
};

const theme = (key: ScheduleThemeKey, label: string): ScheduleTheme => ({
  key,
  label,
  surface: `bg-plan-${key}-surface`,
  accent: `bg-plan-${key}-accent`,
  border: `border-plan-${key}-accent`,
  accentText: `text-plan-${key}-accent`,
});

export const SCHEDULE_THEME_MAP: Record<ScheduleThemeKey, ScheduleTheme> = {
  'warm-gray': theme('warm-gray', 'Warm Gray'),
  rose: theme('rose', 'Rose'),
  coral: theme('coral', 'Coral'),
  amber: theme('amber', 'Amber'),
  lime: theme('lime', 'Lime'),
  green: theme('green', 'Green'),
  teal: theme('teal', 'Teal'),
  cyan: theme('cyan', 'Cyan'),
  blue: theme('blue', 'Blue'),
  violet: theme('violet', 'Violet'),
};

export const SCHEDULE_THEME_LIST: ScheduleTheme[] = SCHEDULE_THEMES.map(
  (k) => SCHEDULE_THEME_MAP[k],
);
