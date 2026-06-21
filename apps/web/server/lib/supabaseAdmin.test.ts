import { afterEach, describe, expect, it, vi } from 'vitest';

import type { getSupabaseAdmin as GetSupabaseAdminType } from './supabaseAdmin.js';

// =============================================================================
// Mocks
// =============================================================================
// @supabase/supabase-js の createClient と env.js を差し替える。
// getSupabaseAdmin() はモジュールレベルの singleton をキャッシュするため、
// キャッシュ分離が必要なテストでは vi.resetModules() してから動的 import する。

const createClientMock = vi.fn(() => ({ auth: { admin: {} } }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

const envState: Record<string, unknown> = {};
vi.mock('./env.js', () => ({
  getServerEnv: () => envState,
}));

const setEnv = (patch: Record<string, unknown>) => {
  for (const k of Object.keys(envState)) delete envState[k];
  Object.assign(envState, patch);
};

const importModule = async (): Promise<{ getSupabaseAdmin: typeof GetSupabaseAdminType }> => {
  vi.resetModules();
  return import('./supabaseAdmin.js');
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// =============================================================================
// Tests
// =============================================================================
describe('getSupabaseAdmin', () => {
  it('service-role key で admin client を生成する', async () => {
    setEnv({
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_role_key',
    });
    const { getSupabaseAdmin } = await importModule();

    const client = getSupabaseAdmin();

    expect(client).toBeDefined();
    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [url, key, opts] = createClientMock.mock.calls[0] as unknown as [
      string,
      string,
      { auth: { persistSession: boolean; autoRefreshToken: boolean }; global: { fetch: typeof fetch } },
    ];
    expect(url).toBe('https://proj.supabase.co');
    expect(key).toBe('sb_secret_role_key');
    // セッション永続化・自動リフレッシュは無効、fetch はラッパが渡る
    expect(opts.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
    expect(typeof opts.global.fetch).toBe('function');
  });

  it('複数回呼んでも同じ singleton を返し createClient を再実行しない', async () => {
    setEnv({
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_role_key',
    });
    const { getSupabaseAdmin } = await importModule();

    const a = getSupabaseAdmin();
    const b = getSupabaseAdmin();

    expect(a).toBe(b);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('fetch ラッパは AbortController の signal を付けて fetch を呼ぶ', async () => {
    setEnv({
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_role_key',
    });
    const { getSupabaseAdmin } = await importModule();
    getSupabaseAdmin();

    const opts = (createClientMock.mock.calls[0] as unknown[])?.[2] as { global: { fetch: typeof fetch } };
    const wrappedFetch = opts.global.fetch;

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    const res = await wrappedFetch('https://proj.supabase.co/auth/v1/admin/users', {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const passedInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(passedInit.method).toBe('GET');
    expect(passedInit.signal).toBeInstanceOf(AbortSignal);
    fetchSpy.mockRestore();
  });

  it('fetch がタイムアウト前に解決すれば signal は abort されない', async () => {
    setEnv({
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_role_key',
    });
    const { getSupabaseAdmin } = await importModule();
    getSupabaseAdmin();

    const opts = (createClientMock.mock.calls[0] as unknown[])?.[2] as { global: { fetch: typeof fetch } };
    const wrappedFetch = opts.global.fetch;

    let capturedSignal: AbortSignal | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      capturedSignal = (init as RequestInit | undefined)?.signal ?? undefined;
      return Promise.resolve(new Response('ok'));
    });

    await wrappedFetch('https://proj.supabase.co');
    expect(capturedSignal?.aborted).toBe(false);
    fetchSpy.mockRestore();
  });
});
