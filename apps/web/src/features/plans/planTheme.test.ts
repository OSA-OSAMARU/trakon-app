import { describe, expect, it } from 'vitest';

import { SCHEDULE_THEME_KEYS } from '@/components/trakon/scheduleTheme';

import { CATEGORY_LABEL, CATEGORY_STYLE, CATEGORY_THEME, planTheme } from './planTheme';

const CATEGORIES = ['wireframe', 'design', 'coding', 'review', 'meeting', 'other'] as const;

describe('planTheme', () => {
  it('6 カテゴリすべてに既定テーマとラベルが定義されている', () => {
    for (const c of CATEGORIES) {
      expect(SCHEDULE_THEME_KEYS).toContain(CATEGORY_THEME[c]);
      expect(CATEGORY_LABEL[c].length).toBeGreaterThan(0);
    }
  });

  it('定義済みカテゴリ数はちょうど 6', () => {
    expect(Object.keys(CATEGORY_THEME)).toHaveLength(6);
    expect(Object.keys(CATEGORY_STYLE)).toHaveLength(6);
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
