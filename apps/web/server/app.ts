import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { errorMiddleware, notFoundHandler } from './middleware/error.js';
import { initSentryServer } from './lib/sentry.js';
import { authRoute } from './routes/v1/auth.js';
import { dashboardRoute } from './routes/v1/dashboard.js';
import { healthRoute } from './routes/v1/healthz.js';
import { invitationsRoute } from './routes/v1/invitations.js';
import { projectsRoute } from './routes/v1/projects.js';
import { shareRoute } from './routes/v1/share.js';

// Sentry の初期化 (SENTRY_DSN 未設定なら no-op)
try {
  initSentryServer();
} catch {
  // env 未設定時は黙って no-op
}

export function createApp() {
  const app = new Hono();

  app.use('*', logger());
  app.use('*', secureHeaders());

  app.route('/api/v1', healthRoute);
  app.route('/api/v1/auth', authRoute);
  app.route('/api/v1/projects', projectsRoute);
  app.route('/api/v1/invitations', invitationsRoute);
  app.route('/api/v1/users/me', dashboardRoute);
  app.route('/api/v1/share', shareRoute);

  app.notFound(notFoundHandler);
  app.onError(errorMiddleware);

  return app;
}

export const app = createApp();
