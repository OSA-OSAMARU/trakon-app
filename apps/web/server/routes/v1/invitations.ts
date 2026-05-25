import { Hono } from 'hono';

import { requireAuth } from '../../middleware/auth.js';
import { attachCurrentUserId } from '../../middleware/projectAuth.js';
import { ApiException } from '../../lib/errors.js';
import { acceptInvitation, verifyInvitation } from '../../services/invitations.js';

/**
 * `/api/v1/invitations/:token`
 *  - GET: 未認証可。トークンを検証してプロジェクト概要を返す
 *  - POST `/accept`: JWT 必須。受諾して project_members.user_id を埋める
 */
export const invitationsRoute = new Hono()
  .get('/:token', async (c) => {
    const token = c.req.param('token');
    if (!token) throw new ApiException('BAD_REQUEST', 400, 'token required.');
    const dto = await verifyInvitation(token);
    return c.json({ data: dto });
  })

  .post('/:token/accept', requireAuth(), attachCurrentUserId(), async (c) => {
    const token = c.req.param('token');
    if (!token) throw new ApiException('BAD_REQUEST', 400, 'token required.');
    const userId = c.get('currentUserId');
    const dto = await acceptInvitation({ rawToken: token, currentUserId: userId });
    return c.json({ data: dto }, 201);
  });
