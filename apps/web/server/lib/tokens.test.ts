import { describe, expect, it } from 'vitest';

import {
  defaultInvitationExpiresAt,
  generateInvitationToken,
  hashToken,
} from './tokens.js';

describe('generateInvitationToken', () => {
  it('returns a base64url string and a SHA-256 hex hash', () => {
    const { raw, hash } = generateInvitationToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes base64url ≈ 43 chars
    expect(raw.length).toBeGreaterThanOrEqual(42);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different tokens on each call', () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it('hashToken is deterministic for the same input', () => {
    const t = 'fixed-token-1234';
    expect(hashToken(t)).toBe(hashToken(t));
  });
});

describe('defaultInvitationExpiresAt', () => {
  it('returns ~72 hours after the given base time', () => {
    const base = new Date('2026-05-25T00:00:00Z');
    const exp = defaultInvitationExpiresAt(base);
    expect(exp.getTime() - base.getTime()).toBe(72 * 60 * 60 * 1000);
  });
});
