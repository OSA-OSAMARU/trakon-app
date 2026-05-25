import { Hono } from 'hono';

import { requireAuth } from '../../middleware/auth.js';
import { completeSignupBodySchema } from '../../schemas/auth.js';
import {
  completeSignup,
  getCurrentUser,
  recordLogin,
  syncUser,
} from '../../services/auth.js';
import { ApiException } from '../../lib/errors.js';

export const authRoute = new Hono()
  .use('*', requireAuth())

  /** Phase 0: 現在ログイン中ユーザーの取得 (users 行が無いと 404) */
  .get('/me', async (c) => {
    const authUser = c.get('authUser');
    const user = await getCurrentUser(authUser.authUserId);
    if (!user) {
      throw new ApiException(
        'PROFILE_NOT_COMPLETED',
        404,
        'Profile is not yet completed. Call /auth/me/sync first.',
      );
    }
    return c.json({ data: user });
  })

  /** Supabase auth.users と public.users を同期 */
  .post('/me/sync', async (c) => {
    const authUser = c.get('authUser');
    const result = await syncUser(authUser.authUserId, authUser.email);
    if (result.status === 'ready') {
      await recordLogin({
        userId: result.user.id,
        ip: c.req.header('x-forwarded-for') ?? undefined,
        userAgent: c.req.header('user-agent') ?? undefined,
      });
      return c.json({
        data: {
          user: result.user,
          requiresProfileCompletion: false,
        },
      });
    }
    return c.json({
      data: {
        user: null,
        requiresProfileCompletion: true,
        email: result.email,
      },
    });
  })

  /** Magic-link サインアップ詳細入力受け取り (users INSERT + パスワード設定) */
  .post('/me/complete-signup', async (c) => {
    const authUser = c.get('authUser');
    const body = completeSignupBodySchema.parse(await c.req.json());
    const user = await completeSignup({
      authUserId: authUser.authUserId,
      email: authUser.email,
      fullName: body.fullName,
      displayName: body.displayName,
      password: body.password,
    });
    await recordLogin({
      userId: user.id,
      ip: c.req.header('x-forwarded-for') ?? undefined,
      userAgent: c.req.header('user-agent') ?? undefined,
    });
    return c.json({ data: user }, 201);
  });
