import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __trakonPrisma: PrismaClient | undefined;
}

/**
 * Supabase の Transaction モードプーラ (pgbouncer, port 6543) では接続が使い回されるため、
 * Prisma の prepared statement が衝突し `42P05 prepared statement "s0" already exists` で
 * クエリが失敗する。これを避けるには接続文字列に `pgbouncer=true` が必要 (prepared statement
 * を無効化する)。env 側で付け忘れても確実に効くようコード側で補完する。
 * - 既に `pgbouncer=` 指定済みなら尊重する
 * - 直結 DB (ローカル等) でも prepared statement を使わなくなるだけで動作に支障はない
 */
function resolveDatasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined; // 未設定時は schema / env からの既定解決に委ねる
  if (/[?&]pgbouncer=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}pgbouncer=true`;
}

const datasourceUrl = resolveDatasourceUrl();

export const prisma: PrismaClient =
  globalThis.__trakonPrisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__trakonPrisma = prisma;
}

export type { Prisma } from '@prisma/client';
export { PrismaClient } from '@prisma/client';
