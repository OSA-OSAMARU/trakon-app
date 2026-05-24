import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { errorMiddleware, notFoundHandler } from './middleware/error.js';
import { healthRoute } from './routes/v1/healthz.js';

export function createApp() {
  const app = new Hono();

  app.use('*', logger());
  app.use('*', secureHeaders());

  app.route('/api/v1', healthRoute);

  app.notFound(notFoundHandler);
  app.onError(errorMiddleware);

  return app;
}

export const app = createApp();
