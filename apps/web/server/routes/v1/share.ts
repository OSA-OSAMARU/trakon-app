import { Hono, type Context } from 'hono';

import { ApiException } from '../../lib/errors.js';
import {
  shareApprove,
  shareRequestReview,
  shareSendBack,
  viewShare,
} from '../../services/shareAccess.js';

/**
 * `/api/v1/share/:token` 配下 (未認証可)。
 * 全アクセスは audit_logs に shareLinkId / IP / UA を記録する。
 *
 * #131: 非会員(クライアント)に確認依頼/承認/差し戻しを許可する。
 * 進行責任者の TOSS(次工程へ進める操作)は共有リンクからは提供しない。
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

  .post('/:token/plans/:planId/request-review', shareActionHandler(shareRequestReview))
  .post('/:token/plans/:planId/approve', shareActionHandler(shareApprove))
  .post('/:token/plans/:planId/send-back', shareActionHandler(shareSendBack));

type ShareAction = (input: {
  rawToken: string;
  planId: string;
  ip?: string;
  userAgent?: string;
}) => Promise<{ plan: unknown }>;

function shareActionHandler(action: ShareAction) {
  return async (c: Context) => {
    const token = c.req.param('token');
    const planId = c.req.param('planId');
    if (!token || !planId) throw new ApiException('BAD_REQUEST', 400, 'token and planId required.');
    const result = await action({
      rawToken: token,
      planId,
      ip: c.req.header('x-forwarded-for') ?? undefined,
      userAgent: c.req.header('user-agent') ?? undefined,
    });
    return c.json({ data: result });
  };
}
