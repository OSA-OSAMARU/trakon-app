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

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const env = getServerEnv();
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
