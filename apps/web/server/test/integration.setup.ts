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
// 実テスト DB が前提。DATABASE_URL を test 用 DB に向けて実行すること。
//   例: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:integration
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
