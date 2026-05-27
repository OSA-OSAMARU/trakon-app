import * as Sentry from '@sentry/react';

/**
 * Sentry FE 初期化 (DSN 未設定なら no-op)。
 * 設計書 §5.7 — PII scrub を有効化、Authorization 系を除去
 */
export function initSentryClient(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['Authorization'];
      }
      return event;
    },
  });
}
