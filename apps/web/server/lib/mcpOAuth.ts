import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Context } from 'hono';

/**
 * AI 連携 (MCP) の OAuth 2.1 認可サーバで使う、DB に依存しない部品。
 * 設計書: docs/design/08-mcp.md §8.5
 */

/** MCP エンドポイントのパス。RFC 8707 の resource / RFC 9728 のリソース識別子になる */
export const MCP_PATH = '/api/mcp';

/** 発行できるスコープ (§8.5.4)。スコープ未指定のリクエストは全部を求めたものとして扱う */
export const MCP_SCOPES = ['read', 'write'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const CLIENT_NAME_MAX = 100;
export const REDIRECT_URIS_MAX = 10;

type TokenKind = 'ac' | 'at' | 'rt';

/**
 * 不透明トークンを発行する。`trk_<kind>_` 接頭辞は漏えい時の検出 (secret scanning) と
 * 取り違え防止のため。DB には hash だけを置く。
 */
export function generateOpaqueToken(kind: TokenKind): { raw: string; hash: string } {
  const raw = `trk_${kind}_${randomBytes(32).toString('base64url')}`;
  return { raw, hash: hashOpaqueToken(raw) };
}

export function hashOpaqueToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** RFC 7636 S256: BASE64URL(SHA256(code_verifier)) == code_challenge */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  // code_verifier は 43〜128 文字の unreserved 文字 (RFC 7636 §4.1)
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return false;
  const computed = createHash('sha256').update(codeVerifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** code_challenge の形式 (S256 の出力 = base64url 43 文字) */
export function isValidCodeChallenge(value: string): boolean {
  return /^[A-Za-z0-9\-_]{43}$/.test(value);
}

/**
 * 登録を受け付ける redirect_uri か (§8.5.1)。
 * - https:// (Claude.ai / ChatGPT などの Web クライアント)
 * - loopback の http:// (RFC 8252 §7.3。Claude Code / Gemini CLI / VS Code などのネイティブクライアント)
 * フラグメント付きは RFC 6749 §3.1.2 で禁止。
 */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || value.includes('#')) return false;
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') {
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  }
  return false;
}

/**
 * 認可リクエストの redirect_uri が登録済みのものと一致するか。
 * 原則は完全一致。loopback だけはポートを問わない (RFC 8252 §7.3: ネイティブアプリは
 * 起動ごとに空きポートを使うため、登録時とポートが変わる)。
 */
export function matchesRegisteredRedirectUri(
  requested: string,
  registered: readonly string[],
): boolean {
  if (registered.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) {
    return false;
  }
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return (
        u.protocol === 'http:' &&
        u.hostname === req.hostname &&
        u.pathname === req.pathname &&
        u.search === req.search
      );
    } catch {
      return false;
    }
  });
}

/**
 * scope パラメータを解釈する。未指定・空なら全スコープ。
 * 未知のスコープが含まれていれば null (= invalid_scope)。
 */
export function parseScope(value: string | null | undefined): McpScope[] | null {
  const parts = (value ?? '').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [...MCP_SCOPES];
  const result: McpScope[] = [];
  for (const p of parts) {
    if (!(MCP_SCOPES as readonly string[]).includes(p)) return null;
    if (!result.includes(p as McpScope)) result.push(p as McpScope);
  }
  // 表記を正規化する (並び順を固定)
  return MCP_SCOPES.filter((s) => result.includes(s));
}

export function formatScope(scopes: readonly McpScope[]): string {
  return scopes.join(' ');
}

/**
 * この環境自身のオリジン。メタデータの issuer や resource の組み立てに使う。
 *
 * `Origin` ヘッダは見ない (ブラウザ型クライアントから来たときに**クライアント側の**オリジンが
 * 入っているため)。プロキシ (Vercel / Vite) の x-forwarded-* を優先し、無ければ URL から取る。
 */
export function resolveSelfOrigin(c: Context): string {
  const forwardedHost = c.req.header('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) {
    const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
    return `${proto}://${forwardedHost}`;
  }
  return new URL(c.req.url).origin;
}

export function mcpResourceUrl(origin: string): string {
  return `${origin}${MCP_PATH}`;
}

/** RFC 9728 保護リソースメタデータ */
export function buildProtectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'TRAKON',
  };
}

/** RFC 8414 認可サーバメタデータ */
export function buildAuthorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    // 同意画面は SPA のページ (SC-20)。普段の TRAKON ログインで本人確認する
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/settings/ai`,
  };
}

/** 401 に付ける WWW-Authenticate (RFC 9728 §5.1) */
export function buildWwwAuthenticate(
  origin: string,
  error?: 'invalid_token' | 'insufficient_scope',
): string {
  const parts = [`resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}"`];
  if (error) parts.push(`error="${error}"`);
  return `Bearer ${parts.join(', ')}`;
}

/** redirect_uri にクエリを足す (既存のクエリは残す) */
export function appendQuery(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return url.toString();
}
