import { Hono, type Context } from 'hono';

import { resolveSelfOrigin } from '../../lib/mcpOAuth.js';
import {
  OAuthError,
  exchangeAuthorizationCode,
  refreshAccessToken,
  registerClient,
  revokeToken,
} from '../../services/mcpOAuth.js';

/**
 * `/api/oauth/*` — AI 連携 (MCP) の OAuth 2.1 エンドポイント (設計書 08-mcp §8.4 / §8.5)。
 * 応答は OAuth の形式 (`{ error, error_description }`) で、API の `{ error: { code } }` 形式ではない。
 */

function oauthError(c: Context, err: OAuthError) {
  c.header('Cache-Control', 'no-store');
  return c.json({ error: err.error, error_description: err.description }, err.status);
}

/** トークン系はフォーム (application/x-www-form-urlencoded) が正。JSON で送るクライアントも受ける */
async function readParams(c: Context): Promise<Record<string, string | undefined>> {
  const type = c.req.header('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]),
    );
  }
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  return Object.fromEntries(
    Object.entries(body).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]),
  );
}

export const oauthRoute = new Hono()
  .onError((err, c) => {
    if (err instanceof OAuthError) return oauthError(c, err);
    throw err;
  })

  .post('/register', async (c) => {
    const body = await c.req.json().catch(() => null);
    const client = await registerClient(body);
    c.header('Cache-Control', 'no-store');
    return c.json(client, 201);
  })

  .post('/token', async (c) => {
    const p = await readParams(c);
    const origin = resolveSelfOrigin(c);
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
    if (p.grant_type === 'authorization_code') {
      return c.json(
        await exchangeAuthorizationCode({
          code: p.code,
          codeVerifier: p.code_verifier,
          clientId: p.client_id,
          redirectUri: p.redirect_uri,
          resource: p.resource,
          origin,
        }),
      );
    }
    if (p.grant_type === 'refresh_token') {
      return c.json(
        await refreshAccessToken({
          refreshToken: p.refresh_token,
          clientId: p.client_id,
          scope: p.scope,
          origin,
        }),
      );
    }
    throw new OAuthError('unsupported_grant_type', 'Supported: authorization_code, refresh_token.');
  })

  // RFC 7009: 不明なトークンでも 200 を返す
  .post('/revoke', async (c) => {
    const p = await readParams(c);
    await revokeToken(p.token);
    return c.body(null, 200);
  });
