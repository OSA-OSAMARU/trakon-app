import { describe, expect, it } from 'vitest';

import { dashboardQuerySchema } from './dashboard.js';

describe('dashboardQuerySchema', () => {
  it('accepts empty query', () => {
    expect(dashboardQuerySchema.safeParse({}).success).toBe(true);
  });

  it('accepts well-formed YYYY-MM-DD', () => {
    expect(dashboardQuerySchema.safeParse({ today: '2026-05-25' }).success).toBe(true);
  });

  it('rejects malformed today', () => {
    expect(dashboardQuerySchema.safeParse({ today: '2026/05/25' }).success).toBe(false);
  });
});
