import { describe, expect, it } from 'vitest';

import { PLAN_CATEGORIES } from '@trakon/shared';

import { SCHEDULE_THEME_KEYS } from '@/components/trakon/scheduleTheme';

import {
  CATEGORY_LABEL,
  CATEGORY_STYLE,
  CATEGORY_THEME,
  planCardStyle,
  planTheme,
  resolvePlanTheme,
} from './planTheme';

// カテゴリの正は @trakon/shared。ここで固定値を持たないことで、値が増えても
// テストが勝手に古くならないようにする (#154)。
const CATEGORIES = PLAN_CATEGORIES;

describe('planTheme', () => {
  it('全カテゴリに既定テーマとラベルが定義されている', () => {
    for (const c of CATEGORIES) {
      expect(SCHEDULE_THEME_KEYS).toContain(CATEGORY_THEME[c]);
      expect(CATEGORY_LABEL[c].length).toBeGreaterThan(0);
    }
  });

  it('定義済みカテゴリは PLAN_CATEGORIES と過不足なく一致する', () => {
    expect(Object.keys(CATEGORY_THEME).sort()).toEqual([...PLAN_CATEGORIES].sort());
    expect(Object.keys(CATEGORY_STYLE).sort()).toEqual([...PLAN_CATEGORIES].sort());
  });

  it('提案は既存カテゴリと重複しない色を持つ (#154)', () => {
    expect(CATEGORY_THEME.proposal).toBe('blue');
    const themes = Object.values(CATEGORY_THEME);
    expect(new Set(themes).size).toBe(themes.length);
  });

  it('CATEGORY_STYLE は新パレット (plan-*) のクラスを返す', () => {
    for (const c of CATEGORIES) {
      const style = CATEGORY_STYLE[c];
      expect(style.bg).toMatch(/^bg-plan-[a-z-]+-surface$/);
      expect(style.text).toMatch(/^text-plan-[a-z-]+-accent$/);
      expect(style.border).toMatch(/^border-plan-[a-z-]+-accent$/);
      expect(style.label).toBe(CATEGORY_LABEL[c]);
    }
  });

  it('planTheme はカテゴリに対応するテーマを返す', () => {
    expect(planTheme('design').key).toBe('cyan');
    expect(planTheme('other').label).toBe('Warm Gray');
  });
});

describe('resolvePlanTheme (#149)', () => {
  it('ユーザーが選んだ色があればそれを使う', () => {
    expect(resolvePlanTheme('design', 'coral').key).toBe('coral');
  });

  it('未設定ならカテゴリ由来の既定色にフォールバックする', () => {
    expect(resolvePlanTheme('design', null).key).toBe('cyan');
    expect(resolvePlanTheme('design').key).toBe('cyan');
  });

  it('planCardStyle も選択された色を反映する', () => {
    expect(planCardStyle('design', 'rose').surface).toBe('bg-plan-rose-surface');
    expect(planCardStyle('design').surface).toBe('bg-plan-cyan-surface');
    // カテゴリのラベルは色を変えても変わらない
    expect(planCardStyle('design', 'rose').label).toBe('デザイン');
  });
});
