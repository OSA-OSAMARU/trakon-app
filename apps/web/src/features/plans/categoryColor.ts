import type { PlanCategory } from './api';

/**
 * カテゴリ 6 値の配色 (Tailwind クラス)。
 * 設計書 SC-07 / SC-08 のカテゴリ表示。完了状態は別途グレーアウト。
 */
export const CATEGORY_STYLE: Record<
  PlanCategory,
  { bg: string; text: string; border: string; label: string }
> = {
  wireframe: {
    bg: 'bg-violet-50',
    text: 'text-violet-700',
    border: 'border-violet-200',
    label: 'ワイヤー',
  },
  design: {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    label: 'デザイン',
  },
  coding: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    label: 'コーディング',
  },
  review: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    label: 'レビュー',
  },
  meeting: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-700',
    border: 'border-yellow-200',
    label: '打ち合わせ',
  },
  other: {
    bg: 'bg-slate-50',
    text: 'text-slate-700',
    border: 'border-slate-200',
    label: 'その他',
  },
};
