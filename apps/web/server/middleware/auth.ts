import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Context, MiddlewareHandler } from 'hono';

import type { ApiError } from '@trakon/shared';

import { getServerEnv } from '../lib/env.js';

export type AuthenticatedUser = {
  authUserId: string;
  email: string;
  /** Supabase JWT 内の `app_metadata.provider` (password / google / azure) */
  provider?: string;
};

declare module 'hono' {
  interface ContextVariableMap {
    authUser: AuthenticatedUser;
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks() {
  if (jwks) return jwks;
  const env = getServerEnv();
  const url = new URL('/auth/v1/.well-known/jwks.json', env.SUPABASE_URL);
  jwks = createRemoteJWKSet(url, {
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });
  return jwks;
}

function authError(c: Context, code: 'AUTH_MISSING' | 'AUTH_INVALID', message: string) {
  return c.json<ApiError>({ error: { code, message } }, 401);
}

function extractToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function toAuthenticatedUser(payload: JWTPayload): AuthenticatedUser | null {
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  const email = typeof payload.email === 'string' ? payload.email : null;
  if (!sub || !email) return null;
  const appMetadata = (payload as { app_metadata?: { provider?: string } }).app_metadata;
  return { authUserId: sub, email, provider: appMetadata?.provider };
}

/**
 * Supabase JWT (RS256) を検証して `c.var.authUser` をセットする。
 * 詳細: docs/design/05-security.md §5.3.7
 */
export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const env = getServerEnv();
    const token = extractToken(c.req.header('authorization'));
    if (!token) return authError(c, 'AUTH_MISSING', 'Authorization header is required.');

    try {
      const { payload } = await jwtVerify(token, getJwks(), {
        issuer: `${env.SUPABASE_URL}/auth/v1`,
        audience: env.SUPABASE_JWT_AUD,
      });
      const user = toAuthenticatedUser(payload);
      if (!user) return authError(c, 'AUTH_INVALID', 'JWT payload is missing required claims.');
      c.set('authUser', user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'JWT verification failed';
      return authError(c, 'AUTH_INVALID', message);
    }

    await next();
  };
}
