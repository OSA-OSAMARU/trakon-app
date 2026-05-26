import { Hono } from 'hono';

import { ApiException } from '../../lib/errors.js';
import {
  shareComplete,
  shareToss,
  viewShare,
} from '../../services/shareAccess.js';

/**
 * `/api/v1/share/:token` 配下 (未認証可)。
 * 全アクセスは audit_logs に shareLinkId / IP / UA を記録する。
 */
export const shareRoute = new Hono()
  .get('/:token', async (c) => {
    const token = c.req.param('token');
    if (!token) throw new ApiException('BAD_REQUEST', 400, 'token required.');
    const dto = await viewShare({
      rawToken: token,
      ip: c.req.header('x-forwarded-for') ?? undefined,
      userAgent: c.req.header('user-agent') ?? undefined,
    });
    c.header('X-Robots-Tag', 'noindex, nofollow');
    return c.json({ data: dto });
  })

  .post('/:token/plans/:planId/toss', async (c) => {
    const token = c.req.param('token');
    const planId = c.req.param('planId');
    if (!token || !planId) throw new ApiException('BAD_REQUEST', 400, 'token and planId required.');
    const result = await shareToss({
      rawToken: token,
      planId,
      ip: c.req.header('x-forwarded-for') ?? undefined,
      userAgent: c.req.header('user-agent') ?? undefined,
    });
    return c.json({ data: result });
  })

  .post('/:token/plans/:planId/complete', async (c) => {
    const token = c.req.param('token');
    const planId = c.req.param('planId');
    if (!token || !planId) throw new ApiException('BAD_REQUEST', 400, 'token and planId required.');
    const result = await shareComplete({
      rawToken: token,
      planId,
      ip: c.req.header('x-forwarded-for') ?? undefined,
      userAgent: c.req.header('user-agent') ?? undefined,
    });
    return c.json({ data: result });
  });
