import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @sentry/react をモックして init 呼び出しと beforeSend の挙動を検証する。
const init = vi.fn();
vi.mock('@sentry/react', () => ({
  init: (...args: unknown[]) => init(...args),
}));

import { initSentryClient } from './sentry';

beforeEach(() => {
  init.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('initSentryClient', () => {
  it('DSN 未設定なら no-op (Sentry.init を呼ばない)', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    initSentryClient();
    expect(init).not.toHaveBeenCalled();
  });

  it('DSN があれば Sentry.init を PII scrub 設定付きで呼ぶ', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://example@sentry.io/1');
    initSentryClient();
    expect(init).toHaveBeenCalledTimes(1);
    const opts = init.mock.calls[0]![0] as {
      dsn: string;
      tracesSampleRate: number;
      sendDefaultPii: boolean;
      beforeSend: (event: unknown) => unknown;
    };
    expect(opts.dsn).toBe('https://example@sentry.io/1');
    expect(opts.tracesSampleRate).toBe(0.1);
    expect(opts.sendDefaultPii).toBe(false);
    expect(typeof opts.beforeSend).toBe('function');
  });

  it('beforeSend が Authorization ヘッダ (大文字/小文字) を除去する', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://example@sentry.io/1');
    initSentryClient();
    const opts = init.mock.calls[0]![0] as {
      beforeSend: (event: unknown) => { request?: { headers?: Record<string, string> } };
    };
    const event = {
      request: {
        headers: {
          authorization: 'Bearer secret',
          Authorization: 'Bearer secret',
          'x-keep': 'ok',
        },
      },
    };
    const out = opts.beforeSend(event);
    expect(out.request?.headers).toEqual({ 'x-keep': 'ok' });
  });

  it('beforeSend は request.headers が無くてもそのまま event を返す', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://example@sentry.io/1');
    initSentryClient();
    const opts = init.mock.calls[0]![0] as {
      beforeSend: (event: unknown) => unknown;
    };
    const event = { message: 'boom' };
    expect(opts.beforeSend(event)).toBe(event);
  });
});
