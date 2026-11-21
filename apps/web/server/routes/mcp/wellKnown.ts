import { Hono } from 'hono';

import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  MCP_PATH,
  resolveSelfOrigin,
} from '../../lib/mcpOAuth.js';

/**
 * `/.well-known/*` — OAuth のメタデータ (設計書 08-mcp §8.4)。
 * Vercel では rewrites で関数へ回している (vercel.json)。
 */
export const wellKnownRoute = new Hono()
  // RFC 9728 は「リソースのパスを後ろに付けた URL」を正とする。付けない版も置く
  // (パス無しで探しに来るクライアントがあるため)
  .get('/oauth-protected-resource', (c) =>
    c.json(buildProtectedResourceMetadata(resolveSelfOrigin(c))),
  )
  .get(`/oauth-protected-resource${MCP_PATH}`, (c) =>
    c.json(buildProtectedResourceMetadata(resolveSelfOrigin(c))),
  )
  .get('/oauth-authorization-server', (c) =>
    c.json(buildAuthorizationServerMetadata(resolveSelfOrigin(c))),
  )
  // RFC 8414 §3.1 の「issuer のパスを後ろに付ける」形で探すクライアント向け
  .get(`/oauth-authorization-server${MCP_PATH}`, (c) =>
    c.json(buildAuthorizationServerMetadata(resolveSelfOrigin(c))),
  );
