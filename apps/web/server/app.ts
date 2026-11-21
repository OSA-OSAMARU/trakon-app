import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { errorMiddleware, notFoundHandler } from './middleware/error.js';
import { initSentryServer } from './lib/sentry.js';
import { authRoute } from './routes/v1/auth.js';
import { billingRoute } from './routes/v1/billing.js';
import { dashboardRoute } from './routes/v1/dashboard.js';
import { healthRoute } from './routes/v1/healthz.js';
import { invitationsRoute } from './routes/v1/invitations.js';
import { organizationsRoute } from './routes/v1/organizations.js';
import { projectsRoute } from './routes/v1/projects.js';
import { shareRoute } from './routes/v1/share.js';
import { stripeWebhookRoute } from './routes/v1/stripeWebhook.js';
import { adminRoute } from './routes/v1/admin.js';
import { aiConnectionsRoute } from './routes/v1/aiConnections.js';
import { oauthAuthorizeRoute } from './routes/v1/oauthAuthorize.js';
import { createMcpRoute } from './routes/mcp/mcp.js';
import { oauthRoute } from './routes/mcp/oauth.js';
import { wellKnownRoute } from './routes/mcp/wellKnown.js';

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
  // 運営専用 (#204)。許可リスト外には 404 を返す
  app.route('/api/v1/admin', adminRoute);
  app.route('/api/v1/billing', billingRoute);
  app.route('/api/v1/projects', projectsRoute);
  app.route('/api/v1/invitations', invitationsRoute);
  app.route('/api/v1/organizations', organizationsRoute);
  app.route('/api/v1/users/me', dashboardRoute);
  app.route('/api/v1/share', shareRoute);

  // ---------------------------------------------------------------------------
  // AI 連携 (MCP サーバ) — 設計書 08-mcp
  // AI クライアント (ブラウザ型を含む) から直接呼ばれるため CORS を全オリジン許可する。
  // Cookie を使わず Bearer のみなので CSRF の対象にならない (§8.4)。
  // ---------------------------------------------------------------------------
  const mcpCors = cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'Mcp-Protocol-Version',
      'Mcp-Session-Id',
      'Last-Event-ID',
    ],
    exposeHeaders: ['WWW-Authenticate', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
    maxAge: 86400,
  });
  app.use('/.well-known/*', mcpCors);
  app.use('/api/oauth/*', mcpCors);
  app.use('/api/mcp', mcpCors);
  app.route('/.well-known', wellKnownRoute);
  app.route('/api/oauth', oauthRoute);
  // ツールは既存 REST をプロセス内で呼ぶ (§8.8)。app 自身の fetch を渡す
  app.route(
    '/api/mcp',
    createMcpRoute((req) => app.fetch(req)),
  );
  // 同意画面 (SC-20) と AI 連携設定 (SC-21) 用。こちらは通常の画面 API (Supabase JWT)
  app.route('/api/v1/oauth', oauthAuthorizeRoute);
  app.route('/api/v1/ai-connections', aiConnectionsRoute);

  app.notFound(notFoundHandler);
  app.onError(errorMiddleware);

  return app;
}

export const app = createApp();
