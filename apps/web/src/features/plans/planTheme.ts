import { PLAN_CATEGORY_SHORT_LABEL, type PlanCategory } from '@trakon/shared';

import {
  SCHEDULE_THEME_MAP,
  type ScheduleTheme,
  type ScheduleThemeKey,
} from '@/components/trakon/scheduleTheme';

/**
 * カテゴリ 7 値 → スケジュールカラーテーマの既定マッピング。
 *
 * Figma のカラーポリシー (node 54:2) では、色は状態ではなくユーザーが視覚整理の
 * ために選ぶもの。予定ごとの色選択が入るまでの間の既定値としてカテゴリから導出する。
 * 旧 categoryColor.ts の色相（violet / sky / emerald / amber / yellow / slate）を
 * 10 テーマの中で最も近いものに寄せている。
 * proposal (#154) は既存 6 値が使っていない色相から blue を割り当てた。
 */
export const CATEGORY_THEME: Record<PlanCategory, ScheduleThemeKey> = {
  proposal: 'blue',
  wireframe: 'violet',
  design: 'cyan',
  coding: 'green',
  review: 'amber',
  meeting: 'lime',
  other: 'warm-gray',
};

/**
 * カード表示用の短縮ラベル。正は @trakon/shared の PLAN_CATEGORY_SHORT_LABEL。
 * 選択肢に出す正式名称は PLAN_CATEGORY_LABEL 側にある。
 */
export const CATEGORY_LABEL = PLAN_CATEGORY_SHORT_LABEL;

export function planTheme(category: PlanCategory): ScheduleTheme {
  return SCHEDULE_THEME_MAP[CATEGORY_THEME[category]];
}

/**
 * 予定に効いているテーマを解決する (#149)。
 * ユーザーが選んだ colorTheme が最優先で、未設定ならカテゴリ由来の既定色になる。
 */
export function resolvePlanTheme(
  category: PlanCategory,
  colorTheme?: ScheduleThemeKey | null,
): ScheduleTheme {
  return colorTheme ? SCHEDULE_THEME_MAP[colorTheme] : planTheme(category);
}

/**
 * スケジュールカードに載せるクラス束。
 * Figma node 54:2 のとおり、文字色は全テーマ共通 (--plan-foreground) で、
 * 淡色の面 + 濃色のアクセント (左ストライプ・枠線) で色を分ける。
 */
export function planCardStyle(
  category: PlanCategory,
  colorTheme?: ScheduleThemeKey | null,
): {
  surface: string;
  stripe: string;
  border: string;
  label: string;
} {
  const t = resolvePlanTheme(category, colorTheme);
  return {
    surface: t.surface,
    stripe: t.accent,
    // 枠線はアクセントを薄めて面から浮きすぎないようにする
    border: `${t.border}/25`,
    label: CATEGORY_LABEL[category],
  };
}

/**
 * 旧 CATEGORY_STYLE 互換のクラス束。
 * 画面側のデザイン刷新は後続フェーズで行うため、既存の呼び出し形を保ったまま
 * 参照する色だけを新パレットへ差し替える。
 */
export const CATEGORY_STYLE: Record<
  PlanCategory,
  { bg: string; text: string; border: string; label: string }
> = Object.fromEntries(
  (Object.keys(CATEGORY_THEME) as PlanCategory[]).map((c) => {
    const t = planTheme(c);
    return [c, { bg: t.surface, text: t.accentText, border: t.border, label: CATEGORY_LABEL[c] }];
  }),
) as Record<PlanCategory, { bg: string; text: string; border: string; label: string }>;
