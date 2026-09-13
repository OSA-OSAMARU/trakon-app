import { describe, expect, it } from 'vitest';

import {
  JOB_TITLES,
  JOB_TITLE_LABEL,
  MEMBER_TYPES,
  MEMBER_TYPE_LABEL,
  PLAN_CATEGORIES,
  PLAN_CATEGORY_LABEL,
  PLAN_CATEGORY_SHORT_LABEL,
} from './index.js';

describe('参加者マスタ', () => {
  it('職種は Figma の 18 種すべてにラベルがある', () => {
    expect(JOB_TITLES).toHaveLength(18);
    expect(new Set(JOB_TITLES).size).toBe(18);
    for (const v of JOB_TITLES) {
      expect(JOB_TITLE_LABEL[v].length).toBeGreaterThan(0);
    }
  });

  it('区分は 3 種で、既存の 2 値を引き継いでいる', () => {
    expect(MEMBER_TYPES).toEqual(['production', 'client', 'partner']);
    for (const v of MEMBER_TYPES) {
      expect(MEMBER_TYPE_LABEL[v].length).toBeGreaterThan(0);
    }
  });
});

describe('予定カテゴリマスタ (#154)', () => {
  it('工程の流れ順に 7 種そろっており、提案が先頭にある', () => {
    expect(PLAN_CATEGORIES).toEqual([
      'proposal',
      'wireframe',
      'design',
      'coding',
      'review',
      'meeting',
      'other',
    ]);
    expect(new Set(PLAN_CATEGORIES).size).toBe(PLAN_CATEGORIES.length);
  });

  it('全カテゴリに正式名称と短縮名がある', () => {
    for (const v of PLAN_CATEGORIES) {
      expect(PLAN_CATEGORY_LABEL[v].length).toBeGreaterThan(0);
      expect(PLAN_CATEGORY_SHORT_LABEL[v].length).toBeGreaterThan(0);
    }
  });

  it('短縮名は正式名称より長くならない', () => {
    for (const v of PLAN_CATEGORIES) {
      expect(PLAN_CATEGORY_SHORT_LABEL[v].length).toBeLessThanOrEqual(
        PLAN_CATEGORY_LABEL[v].length,
      );
    }
  });
});
