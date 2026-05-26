import { Hono } from 'hono';

import { requireAuth } from '../../middleware/auth.js';
import { attachCurrentUserId } from '../../middleware/projectAuth.js';
import { dashboardQuerySchema } from '../../schemas/dashboard.js';
import { getDashboard } from '../../services/dashboard.js';

/**
 * `/api/v1/users/me/dashboard`
 *  - SC-09 ダッシュボード: 今日アクティブな予定をプロジェクト × メンバー で階層集計
 */
export const dashboardRoute = new Hono()
  .use('*', requireAuth())
  .use('*', attachCurrentUserId())
  .get('/dashboard', async (c) => {
    const query = dashboardQuerySchema.parse({ today: c.req.query('today') });
    const userId = c.get('currentUserId');
    const dto = await getDashboard({ currentUserId: userId, query });
    return c.json({ data: dto });
  });
