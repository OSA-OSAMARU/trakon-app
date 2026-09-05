import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiException } from '../../lib/errors.js';
import { __setStripeForTest, getStripe, getWebhookSecret } from './stripeClient.js';

// env を差し替えて、Stripe 未設定の環境でもアプリ全体は起動でき、
// 課金の経路を通ったときだけ 503 になることを固定する。

const envState: Record<string, unknown> = {};
vi.mock('../../lib/env.js', () => ({ getServerEnv: () => envState }));

const setEnv = (patch: Record<string, unknown>) => {
  for (const k of Object.keys(envState)) delete envState[k];
  Object.assign(envState, patch);
};

/** 投げられた例外を値として受け取る (code / status を確かめるため)。 */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('例外が投げられなかった');
}

afterEach(() => {
  __setStripeForTest(undefined);
});

describe('getStripe', () => {
  it('未設定なら 503 BILLING_NOT_CONFIGURED', () => {
    setEnv({});

    const err = thrownBy(getStripe);

    expect(err).toBeInstanceOf(ApiException);
    expect(err).toMatchObject({ code: 'BILLING_NOT_CONFIGURED', status: 503 });
  });

  it('シークレットがあればクライアントを作り、以降はキャッシュを返す', () => {
    setEnv({ STRIPE_SECRET_KEY: 'sk_test_1234567890' });

    expect(getStripe()).toBe(getStripe());
  });

  it('テスト用の差し込み口が優先される (CI から実 Stripe に接続しない)', () => {
    setEnv({});
    const stub = { subscriptions: {} } as never;
    __setStripeForTest(stub);

    expect(getStripe()).toBe(stub);
  });
});

describe('getWebhookSecret', () => {
  it('未設定なら 503 BILLING_NOT_CONFIGURED', () => {
    setEnv({});

    expect(thrownBy(getWebhookSecret)).toMatchObject({
      code: 'BILLING_NOT_CONFIGURED',
      status: 503,
    });
  });

  it('設定されていれば署名検証用のシークレットを返す', () => {
    setEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_1234567890' });

    expect(getWebhookSecret()).toBe('whsec_1234567890');
  });
});
