import { describe, expect, it, beforeAll } from 'vitest';

describe('auth routes', () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-1234567890';
  });

  it('returns AUTH_MISSING when Authorization header is absent', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/auth/me');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_MISSING');
  });

  it('returns AUTH_INVALID for malformed Bearer token', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/auth/me', {
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_INVALID');
  });
});
