import { Hono } from 'hono';

import { requireAuth } from '../../middleware/auth.js';
import { attachCurrentUserId } from '../../middleware/projectAuth.js';
import { ApiException } from '../../lib/errors.js';
import { invitationSignupBodySchema } from '../../schemas/auth.js';
import {
  acceptInvitation,
  signupWithInvitation,
  verifyInvitation,
} from '../../services/invitations.js';

/**
 * `/api/v1/invitations/:token`
 *  - GET: 未認証可。トークンを検証してプロジェクト概要を返す
 *  - POST `/signup`: 未認証可。招待からそのままアカウントを作って受諾する (#233)
 *  - POST `/accept`: JWT 必須。受諾して project_members.user_id を埋める
 */
export const invitationsRoute = new Hono()
  .get('/:token', async (c) => {
    const token = c.req.param('token');
    if (!token) throw new ApiException('BAD_REQUEST', 400, 'token required.');
    const dto = await verifyInvitation(token);
    return c.json({ data: dto });
  })

  /**
   * 招待からの直接登録 (#233)。**未認証で呼べる**。
   *
   * 認証の代わりになっているのは招待トークンそのもの。推測不能な値で、
   * 期限・受諾済み・失効をすべて検証したうえで、**招待に書かれたメール**で
   * アカウントを作る (メールは body で受け取らない)。確認メールを 2 通目として
   * 送らずに済むのは、招待メールが届いている時点でアドレスの所有が
   * 確かめられているため。
   */
  .post('/:token/signup', async (c) => {
    const token = c.req.param('token');
    if (!token) throw new ApiException('BAD_REQUEST', 400, 'token required.');
    const body = invitationSignupBodySchema.parse(await c.req.json());
    const dto = await signupWithInvitation({ rawToken: token, ...body });
    return c.json({ data: dto }, 201);
  })

  .post('/:token/accept', requireAuth(), attachCurrentUserId(), async (c) => {
    const token = c.req.param('token');
    if (!token) throw new ApiException('BAD_REQUEST', 400, 'token required.');
    const userId = c.get('currentUserId');
    const dto = await acceptInvitation({ rawToken: token, currentUserId: userId });
    return c.json({ data: dto }, 201);
  });
