import { describe, expect, it } from 'vitest';

import { app } from '../../app.js';

describe('GET /api/v1/healthz', () => {
  it('returns ok with uptime and timestamp', async () => {
    const res = await app.request('/api/v1/healthz');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; uptime: number; timestamp: string };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.timestamp).toBe('string');
  });

  it('returns NOT_FOUND envelope for unknown routes', async () => {
    const res = await app.request('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
