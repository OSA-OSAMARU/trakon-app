import { Hono } from 'hono';

import type { Health } from '@trakon/shared';

const startedAt = Date.now();

export const healthRoute = new Hono().get('/healthz', (c) => {
  const body: Health = {
    status: 'ok',
    uptime: (Date.now() - startedAt) / 1000,
    timestamp: new Date().toISOString(),
  };
  return c.json(body);
});
