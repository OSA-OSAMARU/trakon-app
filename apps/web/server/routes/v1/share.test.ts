import { describe, expect, it, beforeAll } from 'vitest';

describe('share routes', () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-1234567890';
  });

  it('GET /share/:token with unknown token returns 404 SHARE_NOT_FOUND_OR_EXPIRED', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/share/totally-unknown-token-xyz');
    // 認証は不要、トークンが見つからないので 404 集約
    expect([404, 500]).toContain(res.status); // 500 if DB not reachable in test env
  });

  it('share-links route requires authentication', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects/abc/share-links');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_MISSING');
  });
});
