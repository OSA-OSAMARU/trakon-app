import { Hono } from 'hono';

import { requireAuth } from '../../middleware/auth.js';
import { attachCurrentUserId } from '../../middleware/projectAuth.js';
import { listAiConnections, revokeAiConnection } from '../../services/mcpOAuth.js';

/**
 * `/api/v1/ai-connections` — AI 連携設定 (SC-21)。自分の接続だけを扱う (設計書 08-mcp §8.10)。
 */
export const aiConnectionsRoute = new Hono()
  .use('*', requireAuth())
  .use('*', attachCurrentUserId())
  .get('/', async (c) => {
    const data = await listAiConnections(c.get('currentUserId'));
    return c.json({ data });
  })
  .delete('/:connectionId', async (c) => {
    await revokeAiConnection(c.get('currentUserId'), c.req.param('connectionId'));
    return c.body(null, 204);
  });
