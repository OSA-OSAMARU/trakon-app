import { describe, expect, it } from 'vitest';

import {
  createProjectBodySchema,
  updateProjectBodySchema,
} from './projects.js';

describe('createProjectBodySchema', () => {
  const base = {
    name: 'Test',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    items: [{ name: 'Top' }],
    members: [],
  };

  it('accepts a minimal valid body', () => {
    const r = createProjectBodySchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('rejects when endDate is before startDate', () => {
    const r = createProjectBodySchema.safeParse({
      ...base,
      startDate: '2026-12-31',
      endDate: '2026-01-01',
    });
    expect(r.success).toBe(false);
  });

  it('rejects when items is empty', () => {
    const r = createProjectBodySchema.safeParse({ ...base, items: [] });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate member emails (case-insensitive)', () => {
    const r = createProjectBodySchema.safeParse({
      ...base,
      members: [
        { name: 'A', email: 'a@example.com', organizationName: '', memberType: 'production' },
        { name: 'B', email: 'A@example.com', organizationName: '', memberType: 'client' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const r = createProjectBodySchema.safeParse({ ...base, startDate: '2026/01/01' });
    expect(r.success).toBe(false);
  });
});

describe('updateProjectBodySchema', () => {
  it('accepts a single field update', () => {
    expect(updateProjectBodySchema.safeParse({ name: 'New' }).success).toBe(true);
  });

  it('rejects endDate before startDate when both provided', () => {
    const r = updateProjectBodySchema.safeParse({
      startDate: '2026-12-31',
      endDate: '2026-01-01',
    });
    expect(r.success).toBe(false);
  });
});
