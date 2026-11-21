import { Hono, type MiddlewareHandler } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { buildWwwAuthenticate, resolveSelfOrigin } from '../../lib/mcpOAuth.js';
import { createDispatcher } from '../../mcp/dispatch.js';
import { resolvePlanItemId } from '../../mcp/resolvePlanItemId.js';
import { createTrakonMcpServer } from '../../mcp/tools.js';
import { verifyAccessToken, type McpPrincipal } from '../../services/mcpOAuth.js';

type Env = { Variables: { mcpPrincipal: McpPrincipal } };

/** MCP アクセストークン (不透明トークン) を検証する。失敗時は RFC 9728 の WWW-Authenticate 付き 401 */
function requireMcpToken(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const origin = resolveSelfOrigin(c);
    const [scheme, token] = (c.req.header('authorization') ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      c.header('WWW-Authenticate', buildWwwAuthenticate(origin));
      return c.json(
        { error: 'invalid_request', error_description: 'Bearer token is required.' },
        401,
      );
    }
    const principal = await verifyAccessToken(token, origin);
    if (!principal) {
      c.header('WWW-Authenticate', buildWwwAuthenticate(origin, 'invalid_token'));
      return c.json(
        {
          error: 'invalid_token',
          error_description: 'Access token is invalid, expired, or revoked.',
        },
        401,
      );
    }
    c.set('mcpPrincipal', principal);
    await next();
  };
}

/**
 * `POST /api/mcp` — MCP (Streamable HTTP, ステートレス, JSON 応答)。設計書 08-mcp §8.2 D1/D2
 *
 * リクエストごとに McpServer を作って捨てる (Vercel Functions はインスタンスを共有できない)。
 * ツールは `fetchApp` (= Hono アプリ自身) を通して既存 REST を呼ぶ (§8.8)。
 */
export function createMcpRoute(fetchApp: (req: Request) => Response | Promise<Response>) {
  const methodNotAllowed = () =>
    new Response(
      JSON.stringify({
        error: 'method_not_allowed',
        error_description: 'Use POST (stateless server).',
      }),
      { status: 405, headers: { Allow: 'POST', 'Content-Type': 'application/json' } },
    );

  return (
    new Hono<Env>()
      // サーバ発のストリーム (GET) とセッション終了 (DELETE) は提供しない (ステートレス)
      .get('/', methodNotAllowed)
      .delete('/', methodNotAllowed)
      .post('/', requireMcpToken(), async (c) => {
        const principal = c.get('mcpPrincipal');
        const origin = resolveSelfOrigin(c);

        const server = createTrakonMcpServer({
          dispatch: createDispatcher({
            fetch: fetchApp,
            origin,
            user: { authUserId: principal.authUserId, email: principal.email },
          }),
          scopes: principal.scopes,
          currentUserId: principal.userId,
          resolvePlanItemId,
        });
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        try {
          return await transport.handleRequest(c.req.raw, {
            authInfo: {
              token: '',
              clientId: principal.grantId,
              scopes: principal.scopes,
            },
          });
        } finally {
          await server.close();
        }
      })
  );
}
