import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getServerEnv } from './env.js';

let cached: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const env = getServerEnv();
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
