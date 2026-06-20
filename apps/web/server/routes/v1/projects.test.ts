import { describe, expect, it, beforeAll } from 'vitest';

describe('projects routes', () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-1234567890';
  });

  it('requires authentication for GET /projects', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_MISSING');
  });

  it('requires authentication for POST /projects', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('requires authentication for nested item routes', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects/abc/items');
    expect(res.status).toBe(401);
  });

  it('requires authentication for POST /projects/:id/archive', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects/abc/archive', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('requires authentication for POST /projects/:id/unarchive', async () => {
    const { app } = await import('../../app.js');
    const res = await app.request('/api/v1/projects/abc/unarchive', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
