import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { errorMiddleware, notFoundHandler } from './middleware/error.js';
import { initSentryServer } from './lib/sentry.js';
import { authRoute } from './routes/v1/auth.js';
import { billingRoute } from './routes/v1/billing.js';
import { dashboardRoute } from './routes/v1/dashboard.js';
import { healthRoute } from './routes/v1/healthz.js';
import { invitationsRoute } from './routes/v1/invitations.js';
import { projectsRoute } from './routes/v1/projects.js';
import { shareRoute } from './routes/v1/share.js';
import { stripeWebhookRoute } from './routes/v1/stripeWebhook.js';

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

  // Stripe Webhook は認証なし・署名検証で認可する (設計書 §3.2.4c)。
  // 生ボディが必要なため、このルートでは JSON パースを先に行わない。
  app.route('/api/v1/stripe', stripeWebhookRoute);

  app.route('/api/v1', healthRoute);
  app.route('/api/v1/auth', authRoute);
  app.route('/api/v1/billing', billingRoute);
  app.route('/api/v1/projects', projectsRoute);
  app.route('/api/v1/invitations', invitationsRoute);
  app.route('/api/v1/users/me', dashboardRoute);
  app.route('/api/v1/share', shareRoute);

  app.notFound(notFoundHandler);
  app.onError(errorMiddleware);

  return app;
}

export const app = createApp();
