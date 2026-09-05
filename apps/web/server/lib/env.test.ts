import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { getServerEnv as GetServerEnvType } from './env.js';

// =============================================================================
// getServerEnv() はモジュールレベルで結果をキャッシュするため、
// 各ケースで vi.resetModules() してから動的 import する (mailer.test.ts と同じ流儀)。
// =============================================================================

const BASE = {
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/trakon_test',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-1234567890',
};

const STRIPE = {
  STRIPE_SECRET_KEY: 'sk_test_1234567890',
  STRIPE_WEBHOOK_SECRET: 'whsec_1234567890',
  STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_personal',
  STRIPE_TEAM_MONTHLY_PRICE_ID: 'price_team',
  STRIPE_JP_TAX_RATE_ID: 'txr_jp',
  STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_1',
};

const original = { ...process.env };

async function loadEnv(patch: Record<string, string | undefined>) {
  process.env = { ...BASE, ...patch } as NodeJS.ProcessEnv;
  vi.resetModules();
  const mod: { getServerEnv: typeof GetServerEnvType } = await import('./env.js');
  return mod.getServerEnv;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...original };
});

describe('Stripe の環境変数', () => {
  it('本番以外では未設定を許す (実行時に getStripe() が 503 を返す)', async () => {
    const getServerEnv = await loadEnv({ APP_ENV: 'dev' });

    const env = getServerEnv();

    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.STRIPE_TEAM_MONTHLY_PRICE_ID).toBeUndefined();
  });

  it('本番では 6 つすべてを必須にする (SR-BILL-04)', async () => {
    const getServerEnv = await loadEnv({ APP_ENV: 'prod' });

    expect(() => getServerEnv()).toThrow(/STRIPE_SECRET_KEY は本番環境では必須/);
  });

  it('本番で一部だけ欠けている場合も、欠けている変数名を挙げて落とす', async () => {
    const getServerEnv = await loadEnv({
      APP_ENV: 'prod',
      ...STRIPE,
      STRIPE_PORTAL_CONFIGURATION_ID: undefined,
    });

    // Portal 構成を既定任せにするとプラン変更を無効化できない (§7.8)
    expect(() => getServerEnv()).toThrow(/STRIPE_PORTAL_CONFIGURATION_ID/);
  });

  it('本番で 6 つ揃っていれば読み込める', async () => {
    const getServerEnv = await loadEnv({ APP_ENV: 'prod', ...STRIPE });

    const env = getServerEnv();

    expect(env.STRIPE_SECRET_KEY).toBe('sk_test_1234567890');
    expect(env.STRIPE_JP_TAX_RATE_ID).toBe('txr_jp');
  });
});

describe('getServerEnv', () => {
  it('二度目以降はキャッシュを返す', async () => {
    const getServerEnv = await loadEnv({ APP_ENV: 'dev' });

    expect(getServerEnv()).toBe(getServerEnv());
  });

  it('Supabase のキーが片方も無ければ落とす', async () => {
    process.env = {
      DATABASE_URL: BASE.DATABASE_URL,
      SUPABASE_URL: BASE.SUPABASE_URL,
      APP_ENV: 'dev',
    } as NodeJS.ProcessEnv;
    vi.resetModules();
    const { getServerEnv } = await import('./env.js');

    expect(() => getServerEnv()).toThrow(/SUPABASE_SECRET_KEY/);
  });
});
