import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.SERVER_PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[trakon] Hono dev server listening on http://127.0.0.1:${info.port}`);
});
