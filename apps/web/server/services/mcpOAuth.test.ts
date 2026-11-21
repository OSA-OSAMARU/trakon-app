import { createHash, randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashOpaqueToken } from '../lib/mcpOAuth.js';

// =============================================================================
// Prisma のインメモリ代替 (このサービスが使う範囲だけ)
// =============================================================================

type Client = { id: string; clientName: string; redirectUris: string[]; createdAt: Date };
type Code = {
  id: string;
  codeHash: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  expiresAt: Date;
  consumedAt: Date | null;
};
type Grant = {
  id: string;
  clientId: string;
  userId: string;
  scope: string;
  resource: string;
  accessTokenHash: string;
  accessTokenExpiresAt: Date;
  refreshTokenHash: string;
  refreshTokenExpiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};
type User = { id: string; authUserId: string; email: string; deletedAt: Date | null };

const db = {
  clients: [] as Client[],
  codes: [] as Code[],
  grants: [] as Grant[],
  users: [] as User[],
  audits: [] as Record<string, unknown>[],
};

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { gt?: Date };
      if (c.gt) return v instanceof Date && v > c.gt;
      return true;
    }
    return v === cond;
  });
}

const withRelations = (g: Grant) => ({
  ...g,
  user: db.users.find((u) => u.id === g.userId)!,
  client: db.clients.find((c) => c.id === g.clientId)!,
});

const fakePrisma = {
  mcpClient: {
    create: vi.fn(async ({ data }: { data: Omit<Client, 'id' | 'createdAt'> }) => {
      const row = { id: randomUUID(), createdAt: new Date(), ...data };
      db.clients.push(row);
      return row;
    }),
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) =>
        db.clients.find((c) => c.id === where.id) ?? null,
    ),
  },
  mcpAuthorizationCode: {
    create: vi.fn(async ({ data }: { data: Omit<Code, 'id' | 'consumedAt'> }) => {
      const row = { id: randomUUID(), consumedAt: null, ...data };
      db.codes.push(row);
      return row;
    }),
    updateMany: vi.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Partial<Code> }) => {
        const rows = db.codes.filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    ),
    findUnique: vi.fn(
      async ({ where }: { where: { codeHash: string } }) =>
        db.codes.find((c) => c.codeHash === where.codeHash) ?? null,
    ),
  },
  mcpGrant: {
    create: vi.fn(async ({ data }: { data: Partial<Grant> }) => {
      const row = {
        id: randomUUID(),
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        ...data,
      } as Grant;
      db.grants.push(row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }: { where: Partial<Grant> }) => {
      const g = db.grants.find((r) => matches(r, where));
      return g ? withRelations(g) : null;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const g = db.grants.find((r) => matches(r, where));
      return g ? withRelations(g) : null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      db.grants.filter((r) => matches(r, where)).map(withRelations),
    ),
    updateMany: vi.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Partial<Grant> }) => {
        const rows = db.grants.filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Grant> }) => {
      const g = db.grants.find((r) => r.id === where.id)!;
      Object.assign(g, data);
      return g;
    }),
  },
  auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      db.audits.push(data);
      return data;
    }),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(fakePrisma)),
};

vi.mock('@trakon/db', () => ({ prisma: fakePrisma }));

const svc = await import('./mcpOAuth.js');

// =============================================================================

const ORIGIN = 'https://t.example';
const RESOURCE = `${ORIGIN}/api/mcp`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(50);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

let user: User;

beforeEach(() => {
  db.clients.length = 0;
  db.codes.length = 0;
  db.grants.length = 0;
  db.users.length = 0;
  db.audits.length = 0;
  user = { id: randomUUID(), authUserId: randomUUID(), email: 'u@example.test', deletedAt: null };
  db.users.push(user);
});

async function newClient() {
  return svc.registerClient({ client_name: 'Claude', redirect_uris: [REDIRECT] });
}

function authorizeParams(clientId: string, over: Record<string, string | undefined> = {}) {
  return {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 's1',
    ...over,
  };
}

async function issueCode(clientId: string, scope?: string) {
  const { redirectTo } = await svc.decideAuthorization({
    params: authorizeParams(clientId, { scope }),
    origin: ORIGIN,
    userId: user.id,
    approved: true,
  });
  return new URL(redirectTo).searchParams.get('code')!;
}

async function connect() {
  const client = await newClient();
  const code = await issueCode(client.client_id);
  const tokens = await svc.exchangeAuthorizationCode({
    code,
    codeVerifier: VERIFIER,
    clientId: client.client_id,
    redirectUri: REDIRECT,
    origin: ORIGIN,
  });
  return { client, tokens };
}

describe('registerClient', () => {
  it('公開クライアントとして登録する', async () => {
    const c = await svc.registerClient({
      client_name: '  Claude  ',
      redirect_uris: [REDIRECT, REDIRECT],
      token_endpoint_auth_method: 'none',
    });
    expect(c).toMatchObject({
      client_name: 'Claude',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    });
  });
  it('名前が無ければ既定名、長すぎれば切り詰める', async () => {
    expect((await svc.registerClient({ redirect_uris: [REDIRECT] })).client_name).toBe(
      '名称未設定のアプリ',
    );
    const long = await svc.registerClient({
      client_name: 'x'.repeat(300),
      redirect_uris: [REDIRECT],
    });
    expect(long.client_name).toHaveLength(100);
  });
  it.each([
    [null, 'invalid_client_metadata'],
    [{}, 'invalid_redirect_uri'],
    [{ redirect_uris: [] }, 'invalid_redirect_uri'],
    [{ redirect_uris: [1] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri'],
    [
      { redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' },
      'invalid_client_metadata',
    ],
  ])('不正な登録を拒否する %#', async (body, error) => {
    await expect(svc.registerClient(body)).rejects.toMatchObject({ error });
  });
});

describe('validateAuthorizeRequest', () => {
  it('正しいリクエストは同意画面へ', async () => {
    const c = await newClient();
    const v = await svc.validateAuthorizeRequest(
      authorizeParams(c.client_id, { scope: 'read', resource: `${RESOURCE}/` }),
      ORIGIN,
    );
    expect(v).toMatchObject({
      kind: 'ok',
      client: { name: 'Claude' },
      scopes: ['read'],
      resource: RESOURCE,
    });
  });
  it('ChatGPT などが付ける offline_access があっても通す', async () => {
    const c = await newClient();
    const v = await svc.validateAuthorizeRequest(
      authorizeParams(c.client_id, { scope: 'read write offline_access' }),
      ORIGIN,
    );
    expect(v).toMatchObject({ kind: 'ok', scopes: ['read', 'write'] });
  });
  it('client_id・redirect_uri が信用できなければリダイレクトしない', async () => {
    const c = await newClient();
    expect(await svc.validateAuthorizeRequest({ client_id: 'nope' }, ORIGIN)).toMatchObject({
      kind: 'fatal',
    });
    expect(
      await svc.validateAuthorizeRequest(
        { client_id: randomUUID(), redirect_uri: REDIRECT },
        ORIGIN,
      ),
    ).toMatchObject({ kind: 'fatal' });
    expect(
      await svc.validateAuthorizeRequest(
        authorizeParams(c.client_id, { redirect_uri: 'https://evil.example/cb' }),
        ORIGIN,
      ),
    ).toMatchObject({ kind: 'fatal' });
  });
  it.each([
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ code_challenge: undefined }, 'invalid_request'],
    [{ code_challenge: 'short' }, 'invalid_request'],
    [{ resource: 'https://other.example/api/mcp' }, 'invalid_target'],
  ])('不備は error 付きで戻す %#', async (over, error) => {
    const c = await newClient();
    const v = await svc.validateAuthorizeRequest(authorizeParams(c.client_id, over), ORIGIN);
    expect(v.kind).toBe('redirect_error');
    const url = new URL((v as { redirectTo: string }).redirectTo);
    expect(url.searchParams.get('error')).toBe(error);
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('iss')).toBe(ORIGIN);
  });
});

describe('decideAuthorization', () => {
  it('拒否なら access_denied で戻す', async () => {
    const c = await newClient();
    const { redirectTo } = await svc.decideAuthorization({
      params: authorizeParams(c.client_id),
      origin: ORIGIN,
      userId: user.id,
      approved: false,
    });
    expect(new URL(redirectTo).searchParams.get('error')).toBe('access_denied');
    expect(db.codes).toHaveLength(0);
  });
  it('fatal は 400、redirect_error はそのまま返す', async () => {
    await expect(
      svc.decideAuthorization({ params: {}, origin: ORIGIN, userId: user.id, approved: true }),
    ).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST', status: 400 });
    const c = await newClient();
    const r = await svc.decideAuthorization({
      params: authorizeParams(c.client_id, { response_type: 'token' }),
      origin: ORIGIN,
      userId: user.id,
      approved: true,
    });
    expect(r.redirectTo).toContain('error=unsupported_response_type');
  });
  it('許可するとコードを発行し、DB にはハッシュだけ置く', async () => {
    const c = await newClient();
    const code = await issueCode(c.client_id);
    expect(code).toMatch(/^trk_ac_/);
    expect(db.codes[0]!.codeHash).toBe(hashOpaqueToken(code));
    expect(JSON.stringify(db.codes)).not.toContain(code);
  });
});

describe('exchangeAuthorizationCode', () => {
  it('トークンを発行し、接続と監査ログを残す', async () => {
    const { tokens } = await connect();
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read write' });
    expect(tokens.access_token).toMatch(/^trk_at_/);
    expect(tokens.refresh_token).toMatch(/^trk_rt_/);
    expect(db.grants).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({ action: 'mcp_connected', actorUserId: user.id });
  });

  it('必須パラメータが無ければ invalid_request', async () => {
    await expect(svc.exchangeAuthorizationCode({ origin: ORIGIN })).rejects.toMatchObject({
      error: 'invalid_request',
    });
  });

  it('使用済み・期限切れ・不明なコードは invalid_grant', async () => {
    const c = await newClient();
    const code = await issueCode(c.client_id);
    const input = {
      code,
      codeVerifier: VERIFIER,
      clientId: c.client_id,
      redirectUri: REDIRECT,
      origin: ORIGIN,
    };
    await svc.exchangeAuthorizationCode(input);
    await expect(svc.exchangeAuthorizationCode(input)).rejects.toMatchObject({
      error: 'invalid_grant',
    });

    const code2 = await issueCode(c.client_id);
    db.codes.at(-1)!.expiresAt = new Date(Date.now() - 1000);
    await expect(svc.exchangeAuthorizationCode({ ...input, code: code2 })).rejects.toMatchObject({
      error: 'invalid_grant',
    });
  });

  it.each([
    ['client_id', { clientId: randomUUID() }, 'invalid_grant'],
    ['redirect_uri', { redirectUri: 'https://claude.ai/other' }, 'invalid_grant'],
    ['PKCE', { codeVerifier: 'w'.repeat(50) }, 'invalid_grant'],
    ['resource', { resource: 'https://other.example/api/mcp' }, 'invalid_target'],
    ['別環境', { origin: 'https://preview.example' }, 'invalid_grant'],
  ])('%s の不一致を拒否する', async (_label, over, error) => {
    const c = await newClient();
    const code = await issueCode(c.client_id);
    await expect(
      svc.exchangeAuthorizationCode({
        code,
        codeVerifier: VERIFIER,
        clientId: c.client_id,
        redirectUri: REDIRECT,
        origin: ORIGIN,
        ...over,
      }),
    ).rejects.toMatchObject({ error });
    expect(db.grants).toHaveLength(0);
  });
});

describe('refreshAccessToken', () => {
  it('ローテーションする (古いリフレッシュトークンは 2 回目に使えない)', async () => {
    const { client, tokens } = await connect();
    const next = await svc.refreshAccessToken({
      refreshToken: tokens.refresh_token,
      clientId: client.client_id,
      origin: ORIGIN,
    });
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    await expect(
      svc.refreshAccessToken({
        refreshToken: tokens.refresh_token,
        clientId: client.client_id,
        origin: ORIGIN,
      }),
    ).rejects.toMatchObject({ error: 'invalid_grant' });
  });

  it('スコープは狭めることだけ許す', async () => {
    const { client, tokens } = await connect();
    const narrowed = await svc.refreshAccessToken({
      refreshToken: tokens.refresh_token,
      clientId: client.client_id,
      scope: 'read',
      origin: ORIGIN,
    });
    expect(narrowed.scope).toBe('read');
    await expect(
      svc.refreshAccessToken({
        refreshToken: narrowed.refresh_token,
        clientId: client.client_id,
        scope: 'read write',
        origin: ORIGIN,
      }),
    ).rejects.toMatchObject({ error: 'invalid_scope' });
  });

  it('必須パラメータ・失効・退会・別クライアントを拒否する', async () => {
    await expect(svc.refreshAccessToken({ origin: ORIGIN })).rejects.toMatchObject({
      error: 'invalid_request',
    });
    const { client, tokens } = await connect();
    const base = { refreshToken: tokens.refresh_token, clientId: client.client_id, origin: ORIGIN };
    await expect(svc.refreshAccessToken({ ...base, clientId: randomUUID() })).rejects.toMatchObject(
      {
        error: 'invalid_grant',
      },
    );
    user.deletedAt = new Date();
    await expect(svc.refreshAccessToken(base)).rejects.toMatchObject({ error: 'invalid_grant' });
  });

  it('同時に使われたら 1 つだけ勝つ', async () => {
    const { client, tokens } = await connect();
    fakePrisma.mcpGrant.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      svc.refreshAccessToken({
        refreshToken: tokens.refresh_token,
        clientId: client.client_id,
        origin: ORIGIN,
      }),
    ).rejects.toMatchObject({ error: 'invalid_grant' });
  });
});

describe('verifyAccessToken', () => {
  it('有効なトークンから本人情報を返し、最終利用を記録する', async () => {
    const { tokens } = await connect();
    const p = await svc.verifyAccessToken(tokens.access_token, ORIGIN);
    expect(p).toMatchObject({
      userId: user.id,
      authUserId: user.authUserId,
      email: user.email,
      scopes: ['read', 'write'],
      clientName: 'Claude',
    });
    expect(db.grants[0]!.lastUsedAt).toBeInstanceOf(Date);

    // 直後の再利用では lastUsedAt を書き直さない
    fakePrisma.mcpGrant.update.mockClear();
    await svc.verifyAccessToken(tokens.access_token, ORIGIN);
    expect(fakePrisma.mcpGrant.update).not.toHaveBeenCalled();
  });

  it('接頭辞違い・不明・期限切れ・別環境・失効・退会は null', async () => {
    const { tokens } = await connect();
    expect(await svc.verifyAccessToken('eyJhbGciOi...', ORIGIN)).toBeNull();
    expect(await svc.verifyAccessToken('trk_at_unknown', ORIGIN)).toBeNull();
    expect(await svc.verifyAccessToken(tokens.access_token, 'https://preview.example')).toBeNull();

    db.grants[0]!.accessTokenExpiresAt = new Date(Date.now() - 1);
    expect(await svc.verifyAccessToken(tokens.access_token, ORIGIN)).toBeNull();
    db.grants[0]!.accessTokenExpiresAt = new Date(Date.now() + 60_000);

    user.deletedAt = new Date();
    expect(await svc.verifyAccessToken(tokens.access_token, ORIGIN)).toBeNull();
    user.deletedAt = null;

    db.grants[0]!.revokedAt = new Date();
    expect(await svc.verifyAccessToken(tokens.access_token, ORIGIN)).toBeNull();
  });
});

describe('revokeToken', () => {
  it('アクセストークンでもリフレッシュトークンでも接続ごと失効する', async () => {
    const { tokens } = await connect();
    await svc.revokeToken(tokens.refresh_token);
    expect(db.grants[0]!.revokedAt).toBeInstanceOf(Date);
    expect(db.audits.at(-1)).toMatchObject({ action: 'mcp_revoked', extra: { by: 'client' } });
  });
  it('不明・未指定は何もしない', async () => {
    await svc.revokeToken(undefined);
    await svc.revokeToken('trk_rt_unknown');
    expect(db.audits).toHaveLength(0);
  });
});

describe('AI 連携設定 (SC-21)', () => {
  it('有効な接続だけを一覧し、本人の接続だけ解除できる', async () => {
    const { tokens } = await connect();
    await connect();
    db.grants[1]!.revokedAt = new Date();

    const list = await svc.listAiConnections(user.id);
    expect(list).toEqual([
      expect.objectContaining({
        clientName: 'Claude',
        scopes: ['read', 'write'],
        lastUsedAt: null,
      }),
    ]);
    expect(list[0]!.createdAt).toMatch(/^\d{4}-/);

    await expect(svc.revokeAiConnection(randomUUID(), list[0]!.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(svc.revokeAiConnection(user.id, 'not-a-uuid')).rejects.toMatchObject({
      status: 404,
    });
    await svc.revokeAiConnection(user.id, list[0]!.id);
    expect(await svc.verifyAccessToken(tokens.access_token, ORIGIN)).toBeNull();
    expect(db.audits.at(-1)).toMatchObject({ action: 'mcp_revoked', extra: { by: 'user' } });
    expect(await svc.listAiConnections(user.id)).toEqual([]);
  });
});
