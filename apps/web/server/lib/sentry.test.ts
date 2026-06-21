import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  initSentryServer as InitSentryServerType,
  captureServerError as CaptureServerErrorType,
} from './sentry.js';

// =============================================================================
// Mocks
// =============================================================================
// @sentry/node と env.js を差し替える。initialized はモジュールレベルの
// フラグなので、各テストで vi.resetModules() してから動的 import し分離する。

const initMock = vi.fn();
const captureExceptionMock = vi.fn();
vi.mock('@sentry/node', () => ({
  init: initMock,
  captureException: captureExceptionMock,
}));

const envState: Record<string, unknown> = {};
vi.mock('./env.js', () => ({
  getServerEnv: () => envState,
}));

const setEnv = (patch: Record<string, unknown>) => {
  for (const k of Object.keys(envState)) delete envState[k];
  Object.assign(envState, patch);
};

const importModule = async (): Promise<{
  initSentryServer: typeof InitSentryServerType;
  captureServerError: typeof CaptureServerErrorType;
}> => {
  vi.resetModules();
  return import('./sentry.js');
};

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// initSentryServer
// =============================================================================
describe('initSentryServer', () => {
  it('DSN 未設定なら no-op (Sentry.init は呼ばれない)', async () => {
    setEnv({ APP_ENV: 'dev' });
    const { initSentryServer } = await importModule();

    initSentryServer();
    expect(initMock).not.toHaveBeenCalled();
  });

  it('DSN 設定時に init し、prod は tracesSampleRate 0.1 / PII off', async () => {
    setEnv({ APP_ENV: 'prod', SENTRY_DSN: 'https://key@sentry.io/1' });
    const { initSentryServer } = await importModule();

    initSentryServer();

    expect(initMock).toHaveBeenCalledTimes(1);
    const cfg = initMock.mock.calls[0]?.[0] as {
      dsn: string;
      environment: string;
      tracesSampleRate: number;
      sendDefaultPii: boolean;
      beforeSend: (e: unknown) => unknown;
    };
    expect(cfg.dsn).toBe('https://key@sentry.io/1');
    // SENTRY_ENVIRONMENT 未設定なら APP_ENV にフォールバック
    expect(cfg.environment).toBe('prod');
    expect(cfg.tracesSampleRate).toBe(0.1);
    expect(cfg.sendDefaultPii).toBe(false);
  });

  it('非 prod は tracesSampleRate 0、SENTRY_ENVIRONMENT を優先する', async () => {
    setEnv({
      APP_ENV: 'dev',
      SENTRY_DSN: 'https://key@sentry.io/2',
      SENTRY_ENVIRONMENT: 'staging',
    });
    const { initSentryServer } = await importModule();

    initSentryServer();

    const cfg = initMock.mock.calls[0]?.[0] as {
      environment: string;
      tracesSampleRate: number;
    };
    expect(cfg.environment).toBe('staging');
    expect(cfg.tracesSampleRate).toBe(0);
  });

  it('beforeSend が Authorization/cookie ヘッダを除去する', async () => {
    setEnv({ APP_ENV: 'prod', SENTRY_DSN: 'https://key@sentry.io/3' });
    const { initSentryServer } = await importModule();
    initSentryServer();

    const cfg = initMock.mock.calls[0]?.[0] as {
      beforeSend: (e: unknown) => unknown;
    };
    const event = {
      request: {
        headers: {
          authorization: 'Bearer jwt',
          Authorization: 'Bearer jwt',
          cookie: 'sb=abc',
          'x-keep': 'yes',
        },
      },
    };
    const scrubbed = cfg.beforeSend(event) as typeof event;
    expect(scrubbed.request.headers).not.toHaveProperty('authorization');
    expect(scrubbed.request.headers).not.toHaveProperty('Authorization');
    expect(scrubbed.request.headers).not.toHaveProperty('cookie');
    expect(scrubbed.request.headers['x-keep']).toBe('yes');
  });

  it('headers が無いイベントでも beforeSend はそのまま返す', async () => {
    setEnv({ APP_ENV: 'prod', SENTRY_DSN: 'https://key@sentry.io/4' });
    const { initSentryServer } = await importModule();
    initSentryServer();

    const cfg = initMock.mock.calls[0]?.[0] as { beforeSend: (e: unknown) => unknown };
    const event = { message: 'no request' };
    expect(cfg.beforeSend(event)).toBe(event);
  });

  it('二度目の呼び出しは初期化済みとして no-op になる', async () => {
    setEnv({ APP_ENV: 'prod', SENTRY_DSN: 'https://key@sentry.io/5' });
    const { initSentryServer } = await importModule();

    initSentryServer();
    initSentryServer();
    expect(initMock).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// captureServerError
// =============================================================================
describe('captureServerError', () => {
  it('未初期化なら captureException を呼ばない', async () => {
    setEnv({ APP_ENV: 'dev' }); // DSN 無し → init されない
    const { initSentryServer, captureServerError } = await importModule();
    initSentryServer();

    captureServerError(new Error('boom'), { foo: 'bar' });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('初期化済みなら err と context を Sentry へ転送する', async () => {
    setEnv({ APP_ENV: 'prod', SENTRY_DSN: 'https://key@sentry.io/6' });
    const { initSentryServer, captureServerError } = await importModule();
    initSentryServer();

    const err = new Error('boom');
    captureServerError(err, { requestId: 'req-1' });

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(err, { extra: { requestId: 'req-1' } });
  });

  it('context 省略時は extra: undefined で転送する', async () => {
    setEnv({ APP_ENV: 'prod', SENTRY_DSN: 'https://key@sentry.io/7' });
    const { initSentryServer, captureServerError } = await importModule();
    initSentryServer();

    captureServerError(new Error('x'));
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), { extra: undefined });
  });
});
