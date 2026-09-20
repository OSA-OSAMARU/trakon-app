import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// findAuthUserByEmail (#233)
//
// supabase-js の admin API にメールで引く手段が無いため、GoTrue の admin REST を
// 直接叩いている。`filter` は**部分一致**なので、取得後に完全一致で絞り直せて
// いないと別人を拾う。そこを固定する。
// =============================================================================

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_key_1234567890';
  process.env.SUPABASE_JWT_AUD = 'authenticated';
  process.env.APP_ENV = 'test';
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

function stubFetch(response: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    json: async () => response,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function load() {
  const mod = await import('./supabaseAdmin.js');
  return mod.findAuthUserByEmail;
}

describe('findAuthUserByEmail', () => {
  it('完全一致したユーザーだけを返す', async () => {
    const fetchMock = stubFetch({
      users: [
        { id: 'other', email: 'not-invitee@example.test' },
        { id: 'hit', email: 'invitee@example.test' },
      ],
    });
    const findAuthUserByEmail = await load();

    const user = await findAuthUserByEmail('invitee@example.test');
    expect(user).toEqual({ id: 'hit', email: 'invitee@example.test' });

    const [url] = fetchMock.mock.calls[0]! as unknown as [string];
    expect(url).toContain('/auth/v1/admin/users');
    expect(url).toContain('filter=invitee%40example.test');
  });

  it('部分一致しかしないユーザーは拾わない', async () => {
    // `filter` は部分一致なので「別人だが前方一致する」候補が返ってくる
    stubFetch({ users: [{ id: 'other', email: 'invitee@example.test.jp' }] });
    const findAuthUserByEmail = await load();

    expect(await findAuthUserByEmail('invitee@example.test')).toBeNull();
  });

  it('大文字小文字は区別しない', async () => {
    stubFetch({ users: [{ id: 'hit', email: 'Invitee@Example.test' }] });
    const findAuthUserByEmail = await load();

    expect(await findAuthUserByEmail('invitee@example.test')).toEqual({
      id: 'hit',
      email: 'Invitee@Example.test',
    });
  });

  it('応答が失敗なら null (呼び出し側が 500 に倒す)', async () => {
    stubFetch({}, false);
    const findAuthUserByEmail = await load();

    expect(await findAuthUserByEmail('invitee@example.test')).toBeNull();
  });

  it('該当が無ければ null', async () => {
    stubFetch({ users: [] });
    const findAuthUserByEmail = await load();

    expect(await findAuthUserByEmail('invitee@example.test')).toBeNull();
  });
});
