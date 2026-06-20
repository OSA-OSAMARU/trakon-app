import { describe, expect, it } from 'vitest';

import { createShareLinkBodySchema } from './shareLinks.js';

describe('createShareLinkBodySchema', () => {
  it('accepts project scope without scopeTargetId', () => {
    const r = createShareLinkBodySchema.safeParse({ scopeType: 'project' });
    expect(r.success).toBe(true);
  });

  it('rejects project scope with scopeTargetId', () => {
    const r = createShareLinkBodySchema.safeParse({
      scopeType: 'project',
      scopeTargetId: '11111111-1111-1111-1111-111111111111',
    });
    expect(r.success).toBe(false);
  });

  it('requires scopeTargetId for item scope', () => {
    const r = createShareLinkBodySchema.safeParse({ scopeType: 'item' });
    expect(r.success).toBe(false);
  });

  it('accepts item scope with valid uuid', () => {
    const r = createShareLinkBodySchema.safeParse({
      scopeType: 'item',
      scopeTargetId: '11111111-1111-1111-1111-111111111111',
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid scopeType', () => {
    const r = createShareLinkBodySchema.safeParse({ scopeType: 'invalid' });
    expect(r.success).toBe(false);
  });

  it('clamps expiresInHours upper bound', () => {
    const r = createShareLinkBodySchema.safeParse({
      scopeType: 'project',
      expiresInHours: 24 * 60, // 60 days > max
    });
    expect(r.success).toBe(false);
  });

  it('defaults expiresInHours to 168h (1 week)', () => {
    const r = createShareLinkBodySchema.safeParse({ scopeType: 'project' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.expiresInHours).toBe(168);
  });

  it('accepts null expiresInHours (no expiry)', () => {
    const r = createShareLinkBodySchema.safeParse({
      scopeType: 'project',
      expiresInHours: null,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.expiresInHours).toBeNull();
  });
});
