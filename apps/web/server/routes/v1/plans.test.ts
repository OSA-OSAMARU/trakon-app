import { describe, expect, it, beforeAll } from 'vitest';

describe('plans routes', () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-1234567890';
  });

  it('requires authentication for GET plans list', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects/abc/items/def/plans');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_MISSING');
  });

  it('requires authentication for POST /toss', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects/abc/items/def/plans/xyz/toss', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('requires authentication for POST /complete', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects/abc/items/def/plans/xyz/complete', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('requires authentication for GET project-wide plans', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects/abc/plans');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_MISSING');
  });

  it('requires authentication for POST /copy', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects/abc/items/def/plans/xyz/copy', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_MISSING');
  });

  it('requires authentication for POST /toss-undo', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects/abc/items/def/plans/xyz/toss-undo', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});
