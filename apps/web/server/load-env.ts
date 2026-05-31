/**
 * Dev 専用の環境変数ローダ。
 *
 * `tsx watch server/dev.ts` はフロントの Vite と違い `.env` を自動ロードしない。
 * そのままだと Hono dev サーバが SUPABASE_URL / SUPABASE_SECRET_KEY /
 * DATABASE_URL を持たずに起動し、認証付きリクエストで getServerEnv() が
 * 例外を投げて 500 を返し続ける (フロント直叩きの Supabase 呼び出しだけは
 * Vite が env を読むので動く、という分かりにくい状態になる)。
 *
 * Vite と同じ優先順位 (既存の process.env > .env.local > .env) で読み込む。
 * 本番 (Vercel) は env を直接注入するため、このローダはローカル dev 専用。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 既に設定済みの値は上書きしない。優先度の高いファイルを先に並べる。
for (const file of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;

  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    const key = match?.[1];
    if (!key) continue; // コメント行・空行はスキップ
    if (process.env[key] !== undefined) continue;

    let value = (match[2] ?? '').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
