import { Hono } from 'hono';

import { ApiException } from '../../lib/errors.js';
import { viewShare } from '../../services/shareAccess.js';

/**
 * `/api/v1/share/:token` 配下 (未認証可)。
 * 全アクセスは audit_logs に shareLinkId / IP / UA を記録する。
 *
 * **閲覧専用** (#257)。共有リンクから行えるのは閲覧だけで、確認依頼 / 承認 /
 * 差し戻しなどデータを変える操作は一切提供しない。#131 で許可していた
 * `POST /:token/plans/:planId/{request-review,approve,send-back}` は削除済み
 * (#59 の「共有＝閲覧専用」方針へ戻した。設計書 §3.6.10)。
 */
export const shareRoute = new Hono().get('/:token', async (c) => {
  const token = c.req.param('token');
  if (!token) throw new ApiException('BAD_REQUEST', 400, 'token required.');
  const dto = await viewShare({
    rawToken: token,
    ip: c.req.header('x-forwarded-for') ?? undefined,
    userAgent: c.req.header('user-agent') ?? undefined,
  });
  c.header('X-Robots-Tag', 'noindex, nofollow');
  return c.json({ data: dto });
});
