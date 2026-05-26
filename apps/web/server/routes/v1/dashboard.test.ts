import { describe, expect, it, beforeAll } from 'vitest';

describe('dashboard route', () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-1234567890';
  });

  it('requires authentication for GET /users/me/dashboard', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/users/me/dashboard');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_MISSING');
  });
});
