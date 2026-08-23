import { describe, expect, it } from 'vitest';

import {
  JOB_TITLES,
  JOB_TITLE_LABEL,
  MEMBER_TYPES,
  MEMBER_TYPE_LABEL,
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
