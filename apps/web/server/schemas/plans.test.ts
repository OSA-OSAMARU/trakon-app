import { describe, expect, it } from 'vitest';

import {
  createPlanBodySchema,
  setSuccessorBodySchema,
  tossBodySchema,
  updatePlanBodySchema,
} from './plans.js';

describe('createPlanBodySchema', () => {
  const base = {
    title: 'デザイン依頼',
    category: 'design',
    scheduledDate: '2026-06-01',
    fromMemberId: '11111111-1111-1111-1111-111111111111',
    toMemberId: '22222222-2222-2222-2222-222222222222',
  };

  it('accepts a valid body', () => {
    expect(createPlanBodySchema.safeParse(base).success).toBe(true);
  });

  it('accepts a body with only title + category + scheduledDate (no from/to)', () => {
    const r = createPlanBodySchema.safeParse({
      title: 'ワイヤー作成',
      category: 'design',
      scheduledDate: '2026-06-01',
    });
    expect(r.success).toBe(true);
  });

  it('rejects identical from / to', () => {
    const r = createPlanBodySchema.safeParse({
      ...base,
      toMemberId: base.fromMemberId,
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid category', () => {
    const r = createPlanBodySchema.safeParse({ ...base, category: 'invalid' });
    expect(r.success).toBe(false);
  });

  it('rejects dueDate before scheduledDate', () => {
    const r = createPlanBodySchema.safeParse({
      ...base,
      scheduledDate: '2026-06-10',
      dueDate: '2026-06-01',
    });
    expect(r.success).toBe(false);
  });

  it('accepts each of the 6 allowed categories', () => {
    for (const c of ['wireframe', 'design', 'coding', 'review', 'meeting', 'other']) {
      expect(createPlanBodySchema.safeParse({ ...base, category: c }).success).toBe(true);
    }
  });
});

describe('updatePlanBodySchema', () => {
  const fromId = '11111111-1111-1111-1111-111111111111';
  const toId = '22222222-2222-2222-2222-222222222222';

  it('accepts an empty body', () => {
    expect(updatePlanBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts memo = null (clears memo)', () => {
    expect(updatePlanBodySchema.safeParse({ memo: null }).success).toBe(true);
  });

  it('accepts fromMemberId / toMemberId update', () => {
    expect(
      updatePlanBodySchema.safeParse({ fromMemberId: fromId, toMemberId: toId }).success,
    ).toBe(true);
  });

  it('rejects identical from / to when both provided', () => {
    expect(
      updatePlanBodySchema.safeParse({ fromMemberId: fromId, toMemberId: fromId }).success,
    ).toBe(false);
  });

  it('accepts updating only one of from / to', () => {
    expect(updatePlanBodySchema.safeParse({ toMemberId: toId }).success).toBe(true);
  });

  it('accepts successorPlanId set and null (clear)', () => {
    expect(updatePlanBodySchema.safeParse({ successorPlanId: fromId }).success).toBe(true);
    expect(updatePlanBodySchema.safeParse({ successorPlanId: null }).success).toBe(true);
  });

  it('rejects malformed successorPlanId', () => {
    expect(updatePlanBodySchema.safeParse({ successorPlanId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('setSuccessorBodySchema', () => {
  it('accepts null successorPlanId', () => {
    expect(setSuccessorBodySchema.safeParse({ successorPlanId: null }).success).toBe(true);
  });

  it('rejects malformed uuid', () => {
    expect(setSuccessorBodySchema.safeParse({ successorPlanId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('tossBodySchema', () => {
  it('accepts empty body (defaults to no member override)', () => {
    expect(tossBodySchema.safeParse({}).success).toBe(true);
  });
});
