import { prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';
import {
  ACCESS_TOKEN_TTL_MS,
  AUTHORIZATION_CODE_TTL_MS,
  CLIENT_NAME_MAX,
  REDIRECT_URIS_MAX,
  REFRESH_TOKEN_TTL_MS,
  appendQuery,
  formatScope,
  generateOpaqueToken,
  hashOpaqueToken,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  matchesRegisteredRedirectUri,
  mcpResourceUrl,
  parseScope,
  verifyPkceS256,
  type McpScope,
} from '../lib/mcpOAuth.js';

/**
 * AI 連携 (MCP) の OAuth 2.1 認可サーバ。設計書: docs/design/08-mcp.md §8.5 / §8.6
 *
 * トークン・認可コードは生値を保存しない (SHA-256 のみ)。
 */

/** OAuth のエラー応答 ({ error, error_description }) に変換されるエラー */
export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly description: string,
    public readonly status: 400 | 401 = 400,
  ) {
    super(description);
    this.name = 'OAuthError';
  }
}

const DEFAULT_CLIENT_NAME = '名称未設定のアプリ';

/** lastUsedAt の更新を間引く間隔。毎リクエスト書き込むと MCP 呼び出しごとに UPDATE が走る */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

// =============================================================================
// 動的クライアント登録 (RFC 7591)
// =============================================================================

export type ClientRegistrationResponse = {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
};

export async function registerClient(body: unknown): Promise<ClientRegistrationResponse> {
  if (!body || typeof body !== 'object') {
    throw new OAuthError('invalid_client_metadata', 'Request body must be a JSON object.');
  }
  const meta = body as Record<string, unknown>;

  const redirectUris = meta.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > REDIRECT_URIS_MAX ||
    !redirectUris.every((u): u is string => typeof u === 'string' && u.length <= 2000)
  ) {
    throw new OAuthError(
      'invalid_redirect_uri',
      `redirect_uris must be an array of 1-${REDIRECT_URIS_MAX} URIs.`,
    );
  }
  const invalid = redirectUris.find((u) => !isAllowedRedirectUri(u));
  if (invalid) {
    throw new OAuthError(
      'invalid_redirect_uri',
      'redirect_uris must use https, or http on a loopback address (localhost / 127.0.0.1 / [::1]).',
    );
  }

  // 公開クライアントのみ (シークレットを持たず PKCE で守る)
  const authMethod = meta.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== 'none') {
    throw new OAuthError(
      'invalid_client_metadata',
      'Only public clients are supported (token_endpoint_auth_method=none).',
    );
  }

  const rawName = typeof meta.client_name === 'string' ? meta.client_name.trim() : '';
  const clientName = (rawName || DEFAULT_CLIENT_NAME).slice(0, CLIENT_NAME_MAX);

  const client = await prisma.mcpClient.create({
    data: { clientName, redirectUris: [...new Set(redirectUris)] },
  });

  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

// =============================================================================
// 認可リクエスト (SC-20 同意画面から呼ぶ)
// =============================================================================

export type AuthorizeParams = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
};

export type AuthorizeValidation =
  /** client_id / redirect_uri が信用できない。**リダイレクトしてはいけない** */
  | { kind: 'fatal'; message: string }
  /** 戻り先は信用できるがリクエストに不備がある。error 付きで戻す */
  | { kind: 'redirect_error'; redirectTo: string }
  | {
      kind: 'ok';
      client: { id: string; name: string };
      redirectUri: string;
      scopes: McpScope[];
      codeChallenge: string;
      state: string | undefined;
      resource: string;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeResource(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export async function validateAuthorizeRequest(
  params: AuthorizeParams,
  origin: string,
): Promise<AuthorizeValidation> {
  const clientId = params.client_id;
  if (!clientId || !UUID_RE.test(clientId)) {
    return { kind: 'fatal', message: 'アプリの登録情報 (client_id) が正しくありません。' };
  }
  const client = await prisma.mcpClient.findUnique({ where: { id: clientId } });
  if (!client) {
    return { kind: 'fatal', message: 'このアプリは登録されていません。接続をやり直してください。' };
  }
  const redirectUri = params.redirect_uri;
  if (!redirectUri || !matchesRegisteredRedirectUri(redirectUri, client.redirectUris)) {
    return { kind: 'fatal', message: '戻り先 (redirect_uri) が登録内容と一致しません。' };
  }

  // ここから先は戻り先を信用できるので、不備は error 付きで返す (RFC 6749 §4.1.2.1)
  const iss = origin;
  const fail = (error: string, description: string): AuthorizeValidation => ({
    kind: 'redirect_error',
    redirectTo: appendQuery(redirectUri, {
      error,
      error_description: description,
      state: params.state,
      iss,
    }),
  });

  if (params.response_type !== 'code') {
    return fail('unsupported_response_type', 'Only response_type=code is supported.');
  }
  if (params.code_challenge_method !== 'S256' || !params.code_challenge) {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  if (!isValidCodeChallenge(params.code_challenge)) {
    return fail('invalid_request', 'code_challenge is malformed.');
  }
  const scopes = parseScope(params.scope);
  if (!scopes) {
    return fail('invalid_scope', 'Unknown scope requested. Supported: read, write.');
  }
  const expectedResource = mcpResourceUrl(origin);
  if (params.resource && normalizeResource(params.resource) !== expectedResource) {
    return fail('invalid_target', `resource must be ${expectedResource}.`);
  }

  return {
    kind: 'ok',
    client: { id: client.id, name: client.clientName },
    redirectUri,
    scopes,
    codeChallenge: params.code_challenge,
    state: params.state,
    resource: expectedResource,
  };
}

/**
 * 同意画面の「許可する / 拒否する」。戻り先 URL を返し、SPA がそこへ遷移する。
 * 検証は validateAuthorizeRequest をもう一度通す (画面表示後に改ざんされうるため)。
 */
export async function decideAuthorization(input: {
  params: AuthorizeParams;
  origin: string;
  userId: string;
  approved: boolean;
}): Promise<{ redirectTo: string }> {
  const v = await validateAuthorizeRequest(input.params, input.origin);
  if (v.kind === 'fatal') throw new ApiException('OAUTH_INVALID_REQUEST', 400, v.message);
  if (v.kind === 'redirect_error') return { redirectTo: v.redirectTo };

  if (!input.approved) {
    return {
      redirectTo: appendQuery(v.redirectUri, {
        error: 'access_denied',
        error_description: 'The user denied the request.',
        state: v.state,
        iss: input.origin,
      }),
    };
  }

  const code = generateOpaqueToken('ac');
  await prisma.mcpAuthorizationCode.create({
    data: {
      codeHash: code.hash,
      clientId: v.client.id,
      userId: input.userId,
      redirectUri: v.redirectUri,
      codeChallenge: v.codeChallenge,
      scope: formatScope(v.scopes),
      resource: v.resource,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
    },
  });

  return {
    redirectTo: appendQuery(v.redirectUri, { code: code.raw, state: v.state, iss: input.origin }),
  };
}

// =============================================================================
// トークンエンドポイント
// =============================================================================

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

function issueTokenPair(now: Date) {
  const access = generateOpaqueToken('at');
  const refresh = generateOpaqueToken('rt');
  return {
    access,
    refresh,
    accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
    refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
  };
}

function toTokenResponse(pair: ReturnType<typeof issueTokenPair>, scope: string): TokenResponse {
  return {
    access_token: pair.access.raw,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: pair.refresh.raw,
    scope,
  };
}

export async function exchangeAuthorizationCode(input: {
  code?: string;
  codeVerifier?: string;
  clientId?: string;
  redirectUri?: string;
  resource?: string;
  origin: string;
}): Promise<TokenResponse> {
  if (!input.code || !input.codeVerifier || !input.clientId || !input.redirectUri) {
    throw new OAuthError(
      'invalid_request',
      'code, code_verifier, client_id and redirect_uri are required.',
    );
  }
  const now = new Date();
  const codeHash = hashOpaqueToken(input.code);

  // 先に使用済みにする (同じコードの同時提示で 2 回発行しないため)。
  // 検証に失敗してもコードは戻さない (RFC 6749 §4.1.2: 不正な提示のあったコードは無効化してよい)
  const consumed = await prisma.mcpAuthorizationCode.updateMany({
    where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) {
    throw new OAuthError(
      'invalid_grant',
      'Authorization code is invalid, expired, or already used.',
    );
  }
  const row = await prisma.mcpAuthorizationCode.findUnique({ where: { codeHash } });
  if (!row) throw new OAuthError('invalid_grant', 'Authorization code is invalid.');

  if (row.clientId !== input.clientId) {
    throw new OAuthError('invalid_grant', 'client_id does not match the authorization code.');
  }
  if (row.redirectUri !== input.redirectUri) {
    throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request.');
  }
  if (!verifyPkceS256(input.codeVerifier, row.codeChallenge)) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed.');
  }
  if (input.resource && normalizeResource(input.resource) !== row.resource) {
    throw new OAuthError('invalid_target', 'resource does not match the authorization request.');
  }
  // 別環境 (Preview ↔ Production) で発行されたコードを受け付けない
  if (row.resource !== mcpResourceUrl(input.origin)) {
    throw new OAuthError(
      'invalid_grant',
      'Authorization code was issued for a different resource.',
    );
  }

  const pair = issueTokenPair(now);
  await prisma.$transaction(async (tx) => {
    const grant = await tx.mcpGrant.create({
      data: {
        clientId: row.clientId,
        userId: row.userId,
        scope: row.scope,
        resource: row.resource,
        accessTokenHash: pair.access.hash,
        accessTokenExpiresAt: pair.accessTokenExpiresAt,
        refreshTokenHash: pair.refresh.hash,
        refreshTokenExpiresAt: pair.refreshTokenExpiresAt,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: row.userId,
        action: 'mcp_connected',
        resourceType: 'mcp_grant',
        resourceId: grant.id,
        result: 'success',
        extra: { clientId: row.clientId, scope: row.scope },
      },
    });
  });

  return toTokenResponse(pair, row.scope);
}

export async function refreshAccessToken(input: {
  refreshToken?: string;
  clientId?: string;
  scope?: string;
  origin: string;
}): Promise<TokenResponse> {
  if (!input.refreshToken || !input.clientId) {
    throw new OAuthError('invalid_request', 'refresh_token and client_id are required.');
  }
  const now = new Date();
  const oldHash = hashOpaqueToken(input.refreshToken);
  const grant = await prisma.mcpGrant.findUnique({
    where: { refreshTokenHash: oldHash },
    include: { user: { select: { deletedAt: true } } },
  });
  if (
    !grant ||
    grant.revokedAt ||
    grant.refreshTokenExpiresAt <= now ||
    grant.user.deletedAt ||
    grant.clientId !== input.clientId ||
    grant.resource !== mcpResourceUrl(input.origin)
  ) {
    throw new OAuthError('invalid_grant', 'Refresh token is invalid, expired, or revoked.');
  }

  // スコープは同じか狭めることだけ許す (RFC 6749 §6)
  let scope = grant.scope;
  if (input.scope) {
    const requested = parseScope(input.scope);
    const granted = parseScope(grant.scope) ?? [];
    if (!requested || !requested.every((s) => granted.includes(s))) {
      throw new OAuthError('invalid_scope', 'Requested scope exceeds the original grant.');
    }
    scope = formatScope(requested);
  }

  // ローテーション: 古いリフレッシュトークンを指定した UPDATE が 1 件だけ勝つ
  const pair = issueTokenPair(now);
  const rotated = await prisma.mcpGrant.updateMany({
    where: { id: grant.id, refreshTokenHash: oldHash, revokedAt: null },
    data: {
      scope,
      accessTokenHash: pair.access.hash,
      accessTokenExpiresAt: pair.accessTokenExpiresAt,
      refreshTokenHash: pair.refresh.hash,
      refreshTokenExpiresAt: pair.refreshTokenExpiresAt,
      lastUsedAt: now,
    },
  });
  if (rotated.count !== 1) {
    throw new OAuthError('invalid_grant', 'Refresh token has already been used.');
  }
  return toTokenResponse(pair, scope);
}

/** RFC 7009。トークンが不明でも成功を返す (存在を漏らさない) */
export async function revokeToken(token: string | undefined): Promise<void> {
  if (!token) return;
  const hash = hashOpaqueToken(token);
  const grant = await prisma.mcpGrant.findFirst({
    where: {
      revokedAt: null,
      OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }],
    },
    select: { id: true, userId: true },
  });
  if (!grant) return;
  await revokeGrant(grant.id, grant.userId, 'client');
}

async function revokeGrant(
  grantId: string,
  userId: string,
  by: 'client' | 'user',
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.mcpGrant.updateMany({
      where: { id: grantId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) return false;
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'mcp_revoked',
        resourceType: 'mcp_grant',
        resourceId: grantId,
        result: 'success',
        extra: { by },
      },
    });
    return true;
  });
}

// =============================================================================
// MCP エンドポイントでのトークン検証
// =============================================================================

export type McpPrincipal = {
  grantId: string;
  userId: string;
  authUserId: string;
  email: string;
  scopes: McpScope[];
  clientName: string;
};

export async function verifyAccessToken(
  rawToken: string,
  origin: string,
): Promise<McpPrincipal | null> {
  if (!rawToken.startsWith('trk_at_')) return null;
  const now = new Date();
  const grant = await prisma.mcpGrant.findUnique({
    where: { accessTokenHash: hashOpaqueToken(rawToken) },
    include: {
      user: { select: { id: true, authUserId: true, email: true, deletedAt: true } },
      client: { select: { clientName: true } },
    },
  });
  if (
    !grant ||
    grant.revokedAt ||
    grant.accessTokenExpiresAt <= now ||
    grant.user.deletedAt ||
    // オーディエンス束縛 (RFC 8707): 別環境向けに発行されたトークンは受け付けない
    grant.resource !== mcpResourceUrl(origin)
  ) {
    return null;
  }

  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await prisma.mcpGrant.update({ where: { id: grant.id }, data: { lastUsedAt: now } });
  }

  return {
    grantId: grant.id,
    userId: grant.user.id,
    authUserId: grant.user.authUserId,
    email: grant.user.email,
    scopes: parseScope(grant.scope) ?? [],
    clientName: grant.client.clientName,
  };
}

// =============================================================================
// SC-21 AI 連携設定
// =============================================================================

export type AiConnectionDTO = {
  id: string;
  clientName: string;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
};

/** 有効な接続のみ (失効済み・リフレッシュ期限切れは出さない) */
export async function listAiConnections(userId: string): Promise<AiConnectionDTO[]> {
  const rows = await prisma.mcpGrant.findMany({
    where: { userId, revokedAt: null, refreshTokenExpiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    include: { client: { select: { clientName: true } } },
  });
  return rows.map((g) => ({
    id: g.id,
    clientName: g.client.clientName,
    scopes: parseScope(g.scope) ?? [],
    createdAt: g.createdAt.toISOString(),
    lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function revokeAiConnection(userId: string, grantId: string): Promise<void> {
  const ok = UUID_RE.test(grantId) && (await revokeGrant(grantId, userId, 'user'));
  // 他人の接続 / 存在しない / 解除済みは区別しない
  if (!ok) throw new ApiException('NOT_FOUND', 404, 'Connection not found.');
}
