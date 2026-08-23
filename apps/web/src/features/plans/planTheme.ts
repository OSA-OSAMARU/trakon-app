import {
  SCHEDULE_THEMES,
  type ScheduleTheme,
  type ScheduleThemeKey,
} from '@/components/trakon/scheduleTheme';

import type { PlanCategory } from './api';

/**
 * カテゴリ 6 値 → スケジュールカラーテーマの既定マッピング。
 *
 * Figma のカラーポリシー (node 54:2) では、色は状態ではなくユーザーが視覚整理の
 * ために選ぶもの。予定ごとの色選択が入るまでの間の既定値としてカテゴリから導出する。
 * 旧 categoryColor.ts の色相（violet / sky / emerald / amber / yellow / slate）を
 * 10 テーマの中で最も近いものに寄せている。
 */
export const CATEGORY_THEME: Record<PlanCategory, ScheduleThemeKey> = {
  wireframe: 'violet',
  design: 'cyan',
  coding: 'green',
  review: 'amber',
  meeting: 'lime',
  other: 'warm-gray',
};

export const CATEGORY_LABEL: Record<PlanCategory, string> = {
  wireframe: 'ワイヤー',
  design: 'デザイン',
  coding: 'コーディング',
  review: 'レビュー',
  meeting: '打ち合わせ',
  other: 'その他',
};

export function planTheme(category: PlanCategory): ScheduleTheme {
  return SCHEDULE_THEMES[CATEGORY_THEME[category]];
}

/**
 * スケジュールカードに載せるクラス束。
 * Figma node 54:2 のとおり、文字色は全テーマ共通 (--plan-foreground) で、
 * 淡色の面 + 濃色のアクセント (左ストライプ・枠線) で色を分ける。
 */
export function planCardStyle(category: PlanCategory): {
  surface: string;
  stripe: string;
  border: string;
  label: string;
} {
  const t = planTheme(category);
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
