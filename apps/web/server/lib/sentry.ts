import * as Sentry from '@sentry/node';

import { getServerEnv } from './env.js';

let initialized = false;

/**
 * Sentry を初期化 (DSN 未設定なら no-op)。
 * 設計書 §5.7 / §6.x — PII scrub を有効化、JWT・Authorization を捨てる
 */
export function initSentryServer(): void {
  if (initialized) return;
  const env = getServerEnv();
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.APP_ENV,
    tracesSampleRate: env.APP_ENV === 'prod' ? 0.1 : 0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Authorization ヘッダや supabase JWT らしき文字列を念のため除去
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['Authorization'];
        delete event.request.headers['cookie'];
      }
      return event;
    },
  });
  initialized = true;
}

export function captureServerError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, { extra: context });
}
