import { Hono } from 'hono';

import { requireAuth } from '../../middleware/auth.js';
import { requireOperator } from '../../middleware/operatorAuth.js';
import { getPlatformMetrics } from '../../services/adminMetrics.js';

/**
 * `/api/v1/admin` — 運営専用 (#204)。
 *
 * TRAKON の 3 層認可 (認証 → プロジェクト参加 → ロール) には乗らない。
 * 組織をまたいだ集計を返すので、判定は `requireOperator()` の許可リストのみ。
 * 権限が無い場合は **404 に集約**し、画面の存在自体を気取らせない。
 *
 * **金額は返さない。** 売上・請求は Stripe ダッシュボードが正で、二重に持たない。
 */
export const adminRoute = new Hono()
  .use('*', requireAuth())
  .use('*', requireOperator())

  .get('/metrics', async (c) => {
    const data = await getPlatformMetrics();
    return c.json({ data });
  });
