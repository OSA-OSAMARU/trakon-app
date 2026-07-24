import { describe, expect, it } from 'vitest';

import {
  createPlanBodySchema,
  sendBackBodySchema,
  setSuccessorBodySchema,
  tossBodySchema,
  updatePlanBodySchema,
} from './plans.js';

const EXECUTOR = '11111111-1111-1111-1111-111111111111';
const APPROVER = '22222222-2222-2222-2222-222222222222';
const PROGRESS = '33333333-3333-3333-3333-333333333333';

describe('createPlanBodySchema', () => {
  const base = {
    title: 'デザイン依頼',
    category: 'design',
    scheduledDate: '2026-06-01',
    executorMemberId: EXECUTOR,
    approverMemberId: APPROVER,
    progressManagerMemberId: PROGRESS,
  };

  it('accepts a valid body with all roles', () => {
    expect(createPlanBodySchema.safeParse(base).success).toBe(true);
  });

  it('accepts a body with only title + category + scheduledDate (no roles)', () => {
    const r = createPlanBodySchema.safeParse({
      title: 'ワイヤー作成',
      category: 'design',
      scheduledDate: '2026-06-01',
    });
    expect(r.success).toBe(true);
  });

  it('accepts identical executor / approver (roles may overlap)', () => {
    const r = createPlanBodySchema.safeParse({
      ...base,
      approverMemberId: base.executorMemberId,
    });
    expect(r.success).toBe(true);
  });

  it('rejects a malformed role uuid', () => {
    const r = createPlanBodySchema.safeParse({ ...base, executorMemberId: 'not-a-uuid' });
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
  it('accepts an empty body', () => {
    expect(updatePlanBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts memo = null (clears memo)', () => {
    expect(updatePlanBodySchema.safeParse({ memo: null }).success).toBe(true);
  });

  it('accepts executor / approver / progressManager update', () => {
    expect(
      updatePlanBodySchema.safeParse({
        executorMemberId: EXECUTOR,
        approverMemberId: APPROVER,
        progressManagerMemberId: PROGRESS,
      }).success,
    ).toBe(true);
  });

  it('accepts updating only one role', () => {
    expect(updatePlanBodySchema.safeParse({ approverMemberId: APPROVER }).success).toBe(true);
  });

  it('accepts role = null (clears assignee) (#114)', () => {
    expect(updatePlanBodySchema.safeParse({ executorMemberId: null }).success).toBe(true);
    expect(updatePlanBodySchema.safeParse({ approverMemberId: null }).success).toBe(true);
    expect(updatePlanBodySchema.safeParse({ progressManagerMemberId: null }).success).toBe(true);
  });

  it('rejects a malformed role uuid', () => {
    expect(updatePlanBodySchema.safeParse({ executorMemberId: 'not-a-uuid' }).success).toBe(false);
  });

  it('accepts successorPlanId set and null (clear)', () => {
    expect(updatePlanBodySchema.safeParse({ successorPlanId: EXECUTOR }).success).toBe(true);
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
  it('accepts empty body (#131: TOSS 先の上書きは廃止)', () => {
    expect(tossBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts undefined body', () => {
    expect(tossBodySchema.safeParse(undefined).success).toBe(true);
  });
});

describe('sendBackBodySchema', () => {
  it('accepts empty body', () => {
    expect(sendBackBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts undefined body', () => {
    expect(sendBackBodySchema.safeParse(undefined).success).toBe(true);
  });

  it('accepts a note', () => {
    expect(sendBackBodySchema.safeParse({ note: '修正してください' }).success).toBe(true);
  });

  it('rejects a note over 2000 chars', () => {
    expect(sendBackBodySchema.safeParse({ note: 'a'.repeat(2001) }).success).toBe(false);
  });
});
