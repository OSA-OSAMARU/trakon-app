import { describe, expect, it } from 'vitest';

import { SCHEDULE_THEME_KEYS } from '@/components/trakon/scheduleTheme';

import {
  CATEGORY_LABEL,
  CATEGORY_STYLE,
  CATEGORY_THEME,
  planCardStyle,
  planTheme,
  resolvePlanTheme,
} from './planTheme';

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
