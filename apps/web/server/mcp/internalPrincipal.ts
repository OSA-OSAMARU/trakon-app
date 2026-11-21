import type { AuthenticatedUser } from '../middleware/auth.js';

/**
 * MCP ツールが既存 REST API をプロセス内で呼ぶときの本人情報 (設計書 08-mcp §8.8)。
 *
 * MCP 側で生成した Request オブジェクトだけをこの WeakMap に登録し、`requireAuth()` は
 * `c.req.raw` が登録済みのときに限り JWT 検証の代わりにこの本人情報を採用する。
 * 外部から届く Request は別オブジェクトなので、ヘッダをどう細工してもこの経路には入れない。
 * WeakMap なので処理が終わった Request は GC で消える。
 */
const principals = new WeakMap<Request, AuthenticatedUser>();

export function registerInternalRequest(req: Request, user: AuthenticatedUser): Request {
  principals.set(req, user);
  return req;
}

export function getInternalPrincipal(req: Request): AuthenticatedUser | undefined {
  return principals.get(req);
}
