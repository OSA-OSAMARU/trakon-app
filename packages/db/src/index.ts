import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __trakonPrisma: PrismaClient | undefined;
}

/**
 * Supabase の Transaction モードプーラ (pgbouncer, port 6543) + サーバーレス向けに接続文字列を補正する。
 *
 * - `pgbouncer=true`: prepared statement を無効化。無いと `42P05 prepared statement "s0" already exists`
 *   でクエリが失敗する。直結 DB (ローカル) でも prepared statement を使わなくなるだけで支障なし。
 * - `connection_limit=1` (Vercel のみ): サーバーレスでは各インスタンスが多数の接続を開いてプーラを
 *   枯渇させ、`$transaction` の BEGIN がサーバー接続待ちで滞留 (= 無音の 30s ハング) する。1 接続に
 *   制限してこれを防ぐ (Prisma + Supabase 公式のサーバーレス推奨)。常駐サーバ (ローカル) では付けない。
 *
 * env 側で付け忘れても確実に効くようコードで補完する。既に同名パラメータがあれば尊重する。
 */
function resolveDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined; // 未設定時は schema / env からの既定解決に委ねる

  const add: Record<string, string> = {};
  if (!/[?&]pgbouncer=/.test(raw)) add.pgbouncer = 'true';
  if (process.env.VERCEL && !/[?&]connection_limit=/.test(raw)) add.connection_limit = '1';

  const params = Object.entries(add);
  if (params.length === 0) return raw;

  const sep = raw.includes('?') ? '&' : '?';
  return raw + sep + params.map(([k, v]) => `${k}=${v}`).join('&');
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
