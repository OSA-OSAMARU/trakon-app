import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { app as App } from '../../app.js';
import type { registerInternalRequest as RegisterInternalRequest } from '../../mcp/internalPrincipal.js';
import type * as McpOAuthService from '../../services/mcpOAuth.js';

// =============================================================================
// AI 連携 (MCP) のルーティング層の単体テスト。
// サービスは差し替え、HTTP の形 (ステータス・ヘッダ・OAuth エラー形式) と、
// MCP → 内部 REST 呼び出し → requireAuth の内部経路がつながっていることを見る。
// 実 DB を通す試験は mcp.integration.test.ts。
// =============================================================================

const userFindUnique = vi.fn();
vi.mock('@trakon/db', () => ({ prisma: { user: { findUnique: userFindUnique } } }));

const svc = {
  registerClient: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  refreshAccessToken: vi.fn(),
  revokeToken: vi.fn(),
  verifyAccessToken: vi.fn(),
  validateAuthorizeRequest: vi.fn(),
  decideAuthorization: vi.fn(),
  listAiConnections: vi.fn(),
  revokeAiConnection: vi.fn(),
};
vi.mock('../../services/mcpOAuth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof McpOAuthService>();
  return { ...actual, ...svc };
});
vi.mock('../../mcp/resolvePlanItemId.js', () => ({ resolvePlanItemId: vi.fn(async () => null) }));

let app: typeof App;
let OAuthError: typeof McpOAuthService.OAuthError;
let registerInternalRequest: typeof RegisterInternalRequest;

beforeAll(async () => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-1234567890';
  ({ app } = await import('../../app.js'));
  ({ OAuthError } = await import('../../services/mcpOAuth.js'));
  ({ registerInternalRequest } = await import('../../mcp/internalPrincipal.js'));
});

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  userFindUnique.mockReset();
});

const PRINCIPAL = {
  grantId: 'g1',
  userId: 'u1',
  authUserId: 'au1',
  email: 'u@example.test',
  scopes: ['read'],
  clientName: 'Claude',
};

describe('/.well-known', () => {
  it.each([
    ['/.well-known/oauth-protected-resource', 'resource'],
    ['/.well-known/oauth-protected-resource/api/mcp', 'resource'],
    ['/.well-known/oauth-authorization-server', 'issuer'],
    ['/.well-known/oauth-authorization-server/api/mcp', 'issuer'],
  ])('%s', async (path, key) => {
    const res = await app.request(`https://t.example${path}`, {
      headers: { origin: 'https://claude.ai' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toHaveProperty(key);
  });

  it('CORS のプリフライトに応える', async () => {
    const res = await app.request('https://t.example/api/mcp', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:6274',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });
});

describe('/api/oauth', () => {
  it('register: 201 で返す', async () => {
    svc.registerClient.mockResolvedValue({ client_id: 'c1' });
    const res = await app.request('/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://a.example/cb'] }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ client_id: 'c1' });
  });

  it('register: OAuth の形式でエラーを返す (壊れた JSON も)', async () => {
    svc.registerClient.mockRejectedValue(new OAuthError('invalid_redirect_uri', 'bad'));
    const res = await app.request('/api/oauth/register', { method: 'POST', body: '{' });
    expect(svc.registerClient).toHaveBeenCalledWith(null);
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'invalid_redirect_uri', error_description: 'bad' });
  });

  it('token: フォームの authorization_code', async () => {
    svc.exchangeAuthorizationCode.mockResolvedValue({ access_token: 'a' });
    const res = await app.request('https://t.example/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code&code=c&code_verifier=v&client_id=id&redirect_uri=r',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(svc.exchangeAuthorizationCode).toHaveBeenCalledWith({
      code: 'c',
      codeVerifier: 'v',
      clientId: 'id',
      redirectUri: 'r',
      resource: undefined,
      origin: 'https://t.example',
    });
  });

  it('token: JSON の refresh_token (文字列以外は無視)', async () => {
    svc.refreshAccessToken.mockResolvedValue({ access_token: 'a' });
    const res = await app.request('/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'r', client_id: 1 }),
    });
    expect(res.status).toBe(200);
    expect(svc.refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'r', clientId: undefined }),
    );
  });

  it('token: 未対応の grant_type', async () => {
    const res = await app.request('/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });

  it('token: サービスの OAuthError を変換する', async () => {
    svc.refreshAccessToken.mockRejectedValue(new OAuthError('invalid_grant', 'used'));
    const res = await app.request('/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=r&client_id=c',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant', error_description: 'used' });
  });

  it('token: OAuthError 以外は共通のエラー処理へ', async () => {
    svc.exchangeAuthorizationCode.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await app.request('/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code',
    });
    expect(res.status).toBe(500);
  });

  it('revoke: 常に 200', async () => {
    const res = await app.request('/api/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=t',
    });
    expect(res.status).toBe(200);
    expect(svc.revokeToken).toHaveBeenCalledWith('t');
  });
});

async function rpc(method: string, params: Record<string, unknown> = {}, token = 'trk_at_ok') {
  return app.request('https://t.example/api/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

describe('/api/mcp', () => {
  it.each(['GET', 'DELETE'])('%s は 405', async (method) => {
    const res = await app.request('/api/mcp', { method });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('トークンが無ければ 401 + WWW-Authenticate', async () => {
    const res = await app.request('https://t.example/api/mcp', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://t.example/.well-known/oauth-protected-resource/api/mcp"',
    );
    // ブラウザ型クライアントが WWW-Authenticate を読めるように公開している
    expect(res.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
  });

  it('無効なトークンは 401 invalid_token', async () => {
    svc.verifyAccessToken.mockResolvedValue(null);
    const res = await rpc('tools/list', {}, 'trk_at_bad');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(svc.verifyAccessToken).toHaveBeenCalledWith('trk_at_bad', 'https://t.example');
  });

  it('有効なトークンでスコープ分のツールを返す', async () => {
    svc.verifyAccessToken.mockResolvedValue(PRINCIPAL);
    const res = await rpc('tools/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toContain('get_my_dashboard');
    expect(body.result.tools.map((t) => t.name)).not.toContain('create_plan');
  });

  it('ツールは内部 REST を本人として呼ぶ (requireAuth の内部経路 → 以降は通常の認可)', async () => {
    svc.verifyAccessToken.mockResolvedValue(PRINCIPAL);
    userFindUnique.mockResolvedValue(null); // プロフィール未登録 → REST が 404
    const res = await rpc('tools/call', { name: 'get_my_dashboard', arguments: {} });
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authUserId: 'au1' } }),
    );
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain('PROFILE_NOT_COMPLETED');
  });
});

/** 画面 API は JWT が要る。単体テストでは内部経路で本人を差し込む */
function asUser(path: string, init: RequestInit = {}) {
  userFindUnique.mockResolvedValue({ id: 'u1', deletedAt: null });
  const req = registerInternalRequest(new Request(`https://t.example${path}`, init), {
    authUserId: 'au1',
    email: 'u@example.test',
  });
  return app.fetch(req);
}

describe('/api/v1/oauth/authorize (SC-20)', () => {
  it('未ログインは 401', async () => {
    expect((await app.request('/api/v1/oauth/authorize')).status).toBe(401);
  });

  it('GET: 同意に必要な情報を返す', async () => {
    svc.validateAuthorizeRequest.mockResolvedValue({
      kind: 'ok',
      client: { id: 'c1', name: 'Claude' },
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      scopes: ['read', 'write'],
    });
    const res = await asUser('/api/v1/oauth/authorize?client_id=c1&scope=read');
    expect(await res.json()).toEqual({
      data: {
        status: 'consent',
        client: { id: 'c1', name: 'Claude' },
        redirectHost: 'claude.ai',
        scopes: ['read', 'write'],
      },
    });
    expect(svc.validateAuthorizeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'c1', scope: 'read', state: undefined }),
      'https://t.example',
    );
  });

  it('GET: 不備は戻し先を返す / 信用できなければ 400', async () => {
    svc.validateAuthorizeRequest.mockResolvedValueOnce({
      kind: 'redirect_error',
      redirectTo: 'https://a/cb?error=x',
    });
    expect(await (await asUser('/api/v1/oauth/authorize')).json()).toEqual({
      data: { status: 'redirect', redirectTo: 'https://a/cb?error=x' },
    });
    svc.validateAuthorizeRequest.mockResolvedValueOnce({ kind: 'fatal', message: 'bad' });
    const res = await asUser('/api/v1/oauth/authorize');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'OAUTH_INVALID_REQUEST' } });
  });

  it('POST: 判断を渡して戻し先を返す', async () => {
    svc.decideAuthorization.mockResolvedValue({ redirectTo: 'https://a/cb?code=c' });
    const res = await asUser('/api/v1/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: { client_id: 'c1' }, approved: true }),
    });
    expect(await res.json()).toEqual({ data: { redirectTo: 'https://a/cb?code=c' } });
    expect(svc.decideAuthorization).toHaveBeenCalledWith({
      params: { client_id: 'c1' },
      origin: 'https://t.example',
      userId: 'u1',
      approved: true,
    });
  });
});

describe('/api/v1/ai-connections (SC-21)', () => {
  it('一覧と解除', async () => {
    svc.listAiConnections.mockResolvedValue([{ id: 'g1' }]);
    expect(await (await asUser('/api/v1/ai-connections')).json()).toEqual({ data: [{ id: 'g1' }] });
    expect(svc.listAiConnections).toHaveBeenCalledWith('u1');

    const res = await asUser('/api/v1/ai-connections/g1', { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(svc.revokeAiConnection).toHaveBeenCalledWith('u1', 'g1');
  });
});
