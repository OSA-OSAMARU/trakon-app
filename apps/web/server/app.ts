import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { errorMiddleware, notFoundHandler } from './middleware/error.js';
import { authRoute } from './routes/v1/auth.js';
import { healthRoute } from './routes/v1/healthz.js';
import { invitationsRoute } from './routes/v1/invitations.js';
import { projectsRoute } from './routes/v1/projects.js';

export function createApp() {
  const app = new Hono();

  app.use('*', logger());
  app.use('*', secureHeaders());

  app.route('/api/v1', healthRoute);
  app.route('/api/v1/auth', authRoute);
  app.route('/api/v1/projects', projectsRoute);
  app.route('/api/v1/invitations', invitationsRoute);

  app.notFound(notFoundHandler);
  app.onError(errorMiddleware);

  return app;
}

export const app = createApp();
