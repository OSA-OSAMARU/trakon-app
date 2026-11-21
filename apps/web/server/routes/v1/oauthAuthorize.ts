import { Hono } from 'hono';
import { z } from 'zod';

import { ApiException } from '../../lib/errors.js';
import { resolveSelfOrigin } from '../../lib/mcpOAuth.js';
import { requireAuth } from '../../middleware/auth.js';
import { attachCurrentUserId } from '../../middleware/projectAuth.js';
import {
  decideAuthorization,
  validateAuthorizeRequest,
  type AuthorizeParams,
} from '../../services/mcpOAuth.js';

/**
 * `/api/v1/oauth/authorize` — AI 連携の同意画面 (SC-20) から呼ぶ API (設計書 08-mcp §8.5.2)。
 * 利用者の本人確認は普段の TRAKON ログイン (Supabase JWT) で行う。
 */

const PARAM_KEYS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const;

const paramsSchema = z.object(
  Object.fromEntries(PARAM_KEYS.map((k) => [k, z.string().max(4000).optional()])) as Record<
    (typeof PARAM_KEYS)[number],
    z.ZodOptional<z.ZodString>
  >,
);

const decideBodySchema = z.object({
  params: paramsSchema,
  approved: z.boolean(),
});

export const oauthAuthorizeRoute = new Hono()
  .use('*', requireAuth())
  .use('*', attachCurrentUserId())

  .get('/authorize', async (c) => {
    const params = paramsSchema.parse(
      Object.fromEntries(PARAM_KEYS.map((k) => [k, c.req.query(k)])),
    ) as AuthorizeParams;
    const v = await validateAuthorizeRequest(params, resolveSelfOrigin(c));
    if (v.kind === 'fatal') throw new ApiException('OAUTH_INVALID_REQUEST', 400, v.message);
    if (v.kind === 'redirect_error') {
      return c.json({ data: { status: 'redirect' as const, redirectTo: v.redirectTo } });
    }
    return c.json({
      data: {
        status: 'consent' as const,
        client: v.client,
        // 名前は自己申告。戻り先のホストを並べて見せ、なりすましに気づけるようにする (§8.9)
        redirectHost: new URL(v.redirectUri).host,
        scopes: v.scopes,
      },
    });
  })

  .post('/authorize', async (c) => {
    const body = decideBodySchema.parse(await c.req.json());
    const result = await decideAuthorization({
      params: body.params,
      origin: resolveSelfOrigin(c),
      userId: c.get('currentUserId'),
      approved: body.approved,
    });
    return c.json({ data: result });
  });
