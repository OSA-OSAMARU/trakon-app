import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { WebSocket as WsWebSocket } from 'ws';

import { getServerEnv } from './env.js';

// @supabase/supabase-js は createClient 時に RealtimeClient を eager に初期化し、
// グローバル WebSocket を要求する。Node < 22 にはグローバル WebSocket が無いため
// (本プロジェクトの engines は >=20 <23)、`ws` をポリフィルしておく。
// これを行わないと auth.admin しか使わないサーバ側でも createClient が
// 「Node.js XX detected without native WebSocket support」で throw する。
// Node 22+ や ブラウザ等で既に WebSocket がある場合は上書きしない。
if (typeof globalThis.WebSocket === 'undefined') {
  // ws の型は DOM の WebSocket 型と厳密には一致しないが、realtime-js は
  // コンストラクタとしてしか使わないため unknown 経由で代入する。
  (globalThis as { WebSocket: unknown }).WebSocket = WsWebSocket;
}

let cached: SupabaseClient | undefined;

// Supabase admin 呼び出しがネットワーク要因で無限ハングするのを防ぐため、fetch に
// タイムアウト (AbortController) を被せる。サーバーレスの 30s 上限手前で明示的に失敗させる。
const FETCH_TIMEOUT_MS = 10_000;
function fetchWithTimeout(...args: Parameters<typeof fetch>): Promise<Response> {
  const [input, init] = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const env = getServerEnv();
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout },
  });
  return cached;
}

/**
 * メールアドレスから Supabase Auth のユーザーを引く (#233)。
 *
 * supabase-js の `admin.listUsers()` はページ指定しか受けられず、メールで引く
 * API が無い。GoTrue の admin REST は `?filter=` を持っているので、そこだけ
 * 直接叩く。`filter` は部分一致なので、取得後に完全一致で絞り直す。
 *
 * 使いどころは「招待からの直接登録で、auth 側にだけ行が残っている人」を拾う
 * 一点のみ (マジックリンクを踏んだがプロフィール登録まで進まなかった場合)。
 * 通常経路では呼ばれない。
 */
export async function findAuthUserByEmail(
  email: string,
): Promise<{ id: string; email: string } | null> {
  const env = getServerEnv();
  const url = new URL('/auth/v1/admin/users', env.SUPABASE_URL);
  url.searchParams.set('filter', email);
  url.searchParams.set('per_page', '50');

  const res = await fetchWithTimeout(url.toString(), {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    },
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { users?: Array<{ id: string; email?: string | null }> };
  const target = email.toLowerCase();
  const hit = (body.users ?? []).find((u) => (u.email ?? '').toLowerCase() === target);
  return hit ? { id: hit.id, email: hit.email ?? email } : null;
}
