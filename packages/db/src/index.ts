import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __trakonPrisma: PrismaClient | undefined;
}

/**
 * DATABASE_URL を「Supabase Transaction プーラ (pgbouncer, port 6543) + サーバーレス」向けに正規化する。
 *
 * - `pgbouncer=true`: prepared statement を無効化。無いと `42P05 prepared statement "s0" already exists`。
 *   直結 DB (ローカル) でも prepared statement を使わなくなるだけで支障なし。
 * - `connection_limit=1` (Vercel のみ): サーバーレスでの接続枯渇 (= プール checkout タイムアウト) を防ぐ
 *   Prisma + Supabase 公式の推奨。常駐サーバ (ローカル) では付けない。
 *
 * 接続文字列は env とコードの「二重組み立て」になりがちで、`?` を付け忘れた手編集 (例:
 * `.../postgres&connection_limit=1`) があると DB 名が `postgres&connection_limit=1` と解釈され
 * `P1003 Database does not exist` で全クエリが落ちる。これを避けるため、壊れた値も含めて
 * 「DB 名」と「クエリ」を分離して妥当な URL に組み直す。
 *
 * 認証情報を壊さないよう URL パーサは使わず、`@` より後の最初の `/` 以降 (= DB 名 + クエリ部) だけを
 * 処理する (パスワードに `/` が含まれても安全)。
 */
function resolveDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined; // 未設定時は schema / env からの既定解決に委ねる

  const at = raw.lastIndexOf('@'); // 認証情報は @ より前。触らない。
  const pathStart = raw.indexOf('/', at < 0 ? 0 : at);
  if (pathStart < 0) return raw; // 想定外フォーマットはそのまま返す

  const prefix = raw.slice(0, pathStart); // postgresql://user:pass@host:6543
  const rest = raw.slice(pathStart + 1); // "postgres" | "postgres?x=y" | 破損 "postgres&x=y"

  const sep = rest.search(/[?&]/);
  const db = sep < 0 ? rest : rest.slice(0, sep);
  const paramStr = sep < 0 ? '' : rest.slice(sep + 1).replace(/&{2,}/g, '&').replace(/^&/, '');

  const params = new URLSearchParams(paramStr);
  if (!params.has('pgbouncer')) params.set('pgbouncer', 'true');
  if (process.env.VERCEL && !params.has('connection_limit')) params.set('connection_limit', '1');

  const query = params.toString();
  return query ? `${prefix}/${db}?${query}` : `${prefix}/${db}`;
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
