import { afterAll, beforeAll, beforeEach, vi } from 'vitest';
import type * as Jose from 'jose';

import { prisma } from '@trakon/db';

import { initTestAuth, testJwksResolver } from './auth.js';

// =============================================================================
// BE 統合テストのグローバルセットアップ (web-server-integration プロジェクト専用)
// -----------------------------------------------------------------------------
//   - jose の createRemoteJWKSet をローカル鍵セットへ差し替え (auth.ts 参照)
//   - 必要な env のデフォルトを充足
//   - 各テスト前に全テーブルを TRUNCATE して独立性を担保
//
// **使い捨てのテスト DB が前提**。各テスト前に全テーブルを TRUNCATE するため、
// 開発 DB を指すとローカルのデータが消える。手順は README「BE 統合テストの方針」参照。
//   例: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/trakon_test pnpm test:integration
// =============================================================================

// createRemoteJWKSet のみ差し替え、jwtVerify 等は本物を使う。
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof Jose>();
  return { ...actual, createRemoteJWKSet: () => testJwksResolver() };
});

// requireAuth() が要求する env のデフォルト (リモートには接続しない)。
process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key-1234567890';
process.env.SUPABASE_JWT_AUD ??= 'authenticated';
process.env.APP_ENV ??= 'test';
process.env.NODE_ENV = 'test';

/**
 * Stripe のテスト値。
 *
 * **ここで設定する理由**: `getServerEnv()` は初回アクセス時に env をキャッシュする。
 * 各テストの beforeEach で process.env を書き換えても、先に別のテストが
 * getServerEnv() を呼んでいると反映されない。setupFiles はどのテストより先に
 * 走るので、ここで入れておけば確実にキャッシュへ載る (設計書 §7.3.3 / 実装メモ)。
 *
 * 実 Stripe には CI から一切接続しない。値はダミーで、
 * 署名検証だけ SDK のテストヘルパーで実際に通す。
 */
export const TEST_STRIPE = {
  secretKey: 'sk_test_dummy_key_for_signing',
  webhookSecret: 'whsec_test_secret_value',
  personalPriceId: 'price_test_personal',
  teamPriceId: 'price_test_team',
  taxRateId: 'txr_test_jp',
  portalConfigurationId: 'bpc_test_configuration',
} as const;

process.env.STRIPE_SECRET_KEY ??= TEST_STRIPE.secretKey;
process.env.STRIPE_WEBHOOK_SECRET ??= TEST_STRIPE.webhookSecret;
process.env.STRIPE_PERSONAL_MONTHLY_PRICE_ID ??= TEST_STRIPE.personalPriceId;
process.env.STRIPE_TEAM_MONTHLY_PRICE_ID ??= TEST_STRIPE.teamPriceId;
process.env.STRIPE_JP_TAX_RATE_ID ??= TEST_STRIPE.taxRateId;
process.env.STRIPE_PORTAL_CONFIGURATION_ID ??= TEST_STRIPE.portalConfigurationId;

// TRUNCATE 対象 (FK 依存順は CASCADE で吸収)。
const TABLES = [
  'audit_logs',
  'ball_events',
  'plans',
  'invitations',
  'share_links',
  'project_items',
  'project_members',
  'projects',
  'stripe_events',
  'billing_trial_claims',
  'billing_subscriptions',
  'organization_members',
  'organizations',
  'oauth_identities',
  'users',
];

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      '[integration] DATABASE_URL is required for integration tests. ' +
        'Point it at a disposable test database and run `pnpm db:deploy` first.',
    );
  }
  await initTestAuth();
  // 接続確認 (失敗時に分かりやすいエラーを出す)
  await prisma.$queryRawUnsafe('SELECT 1');
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});
