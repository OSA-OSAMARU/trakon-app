import { describe, expect, it } from 'vitest';

import { CATEGORY_STYLE } from './categoryColor';

const CATEGORIES = ['wireframe', 'design', 'coding', 'review', 'meeting', 'other'] as const;

describe('CATEGORY_STYLE', () => {
  it('6 カテゴリすべてにスタイルとラベルが定義されている', () => {
    for (const c of CATEGORIES) {
      const style = CATEGORY_STYLE[c];
      expect(style).toBeDefined();
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.bg).toMatch(/^bg-/);
      expect(style.text).toMatch(/^text-/);
      expect(style.border).toMatch(/^border-/);
    }
  });

  it('定義済みカテゴリ数はちょうど 6', () => {
    expect(Object.keys(CATEGORY_STYLE)).toHaveLength(6);
  });
});
