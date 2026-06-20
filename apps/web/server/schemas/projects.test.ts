import { describe, expect, it } from 'vitest';

import {
  createProjectBodySchema,
  listProjectsQuerySchema,
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

describe('listProjectsQuerySchema', () => {
  it("parses archived='true' as boolean true", () => {
    const r = listProjectsQuerySchema.parse({ archived: 'true' });
    expect(r.archived).toBe(true);
  });

  it("parses archived='false' as boolean false", () => {
    const r = listProjectsQuerySchema.parse({ archived: 'false' });
    expect(r.archived).toBe(false);
  });

  it('leaves archived undefined when omitted', () => {
    const r = listProjectsQuerySchema.parse({});
    expect(r.archived).toBeUndefined();
  });

  it('rejects an invalid archived value', () => {
    expect(listProjectsQuerySchema.safeParse({ archived: 'yes' }).success).toBe(false);
  });

  it('applies default limit/offset', () => {
    const r = listProjectsQuerySchema.parse({});
    expect(r.limit).toBe(50);
    expect(r.offset).toBe(0);
  });
});
