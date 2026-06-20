import type { Context } from 'hono';

import { getServerEnv } from './env.js';

/**
 * リクエスト元のオリジン (scheme + host) を解決する。
 * 共有 URL を「発行元と同じドメイン」で組み立てるために使用する (#59)。
 *
 * 解決順序:
 *  1. `Origin` ヘッダ (ブラウザ fetch が付与)
 *  2. `x-forwarded-proto` + `x-forwarded-host` (Vercel などのプロキシ経由)
 *  3. `Host` ヘッダ (scheme は x-forwarded-proto か https を仮定)
 *  4. `env.PUBLIC_APP_URL` (フォールバック)
 */
export function resolveRequestOrigin(c: Context): string {
  const origin = c.req.header('origin');
  if (origin && /^https?:\/\//.test(origin)) {
    return stripTrailingSlash(origin);
  }

  const forwardedHost = c.req.header('x-forwarded-host');
  const forwardedProto = c.req.header('x-forwarded-proto');
  if (forwardedHost) {
    const proto = forwardedProto?.split(',')[0]?.trim() || 'https';
    return `${proto}://${forwardedHost.split(',')[0]?.trim()}`;
  }

  const host = c.req.header('host');
  if (host) {
    const proto = forwardedProto?.split(',')[0]?.trim() || 'https';
    return `${proto}://${host}`;
  }

  return stripTrailingSlash(getServerEnv().PUBLIC_APP_URL);
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
