import { Hono } from 'hono';

import { requireAuth } from '../../middleware/auth.js';
import {
  completeSignupBodySchema,
  deleteAccountBodySchema,
  updateProfileBodySchema,
} from '../../schemas/auth.js';
import {
  completeSignup,
  deleteAccount,
  getCurrentUser,
  recordLogin,
  removeAvatar,
  replaceAvatar,
  syncUser,
  updateProfile,
} from '../../services/auth.js';
import { AVATAR_MAX_BYTES } from '../../lib/avatarStorage.js';
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

  /** プロフィール / 認証情報の更新 (氏名・表示名・所属名・職種・通知先メール・パスワード) */
  .patch('/me', async (c) => {
    const authUser = c.get('authUser');
    const body = updateProfileBodySchema.parse(await c.req.json());
    const user = await updateProfile({
      authUserId: authUser.authUserId,
      fullName: body.fullName,
      displayName: body.displayName,
      organizationName: body.organizationName,
      jobTitle: body.jobTitle,
      notificationEmail: body.notificationEmail,
      newPassword: body.newPassword,
    });
    return c.json({ data: user });
  })

  /**
   * プロフィール画像のアップロード (#157)。multipart/form-data の `file` を受ける。
   *
   * 画像の切り抜き・リサイズはクライアント側で済ませて送ってもらう。サーバーで
   * 画像処理 (sharp 等) を行うと Vercel のバンドルにネイティブ依存が乗るため、
   * ここでは検証 (サイズ / MIME / マジックバイト) と保存だけを担う。
   */
  .post('/me/avatar', async (c) => {
    const authUser = c.get('authUser');

    // Content-Length で早期に弾く (本文を読み切る前に打ち切る)
    const declaredLength = Number(c.req.header('content-length') ?? 0);
    if (declaredLength > AVATAR_MAX_BYTES * 1.1) {
      throw new ApiException(
        'AVATAR_TOO_LARGE',
        413,
        `画像は ${AVATAR_MAX_BYTES / 1024 / 1024}MB 以下にしてください。`,
      );
    }

    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ApiException('AVATAR_MISSING', 422, '画像ファイルを選んでください。');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const user = await replaceAvatar({
      authUserId: authUser.authUserId,
      bytes,
      size: bytes.byteLength,
      declaredType: file.type,
    });
    return c.json({ data: user });
  })

  /** プロフィール画像を外す (#157) */
  .delete('/me/avatar', async (c) => {
    const authUser = c.get('authUser');
    const user = await removeAvatar(authUser.authUserId);
    return c.json({ data: user });
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
  })

  /** 退会 (アカウント削除): 論理削除 + 匿名化 + Supabase Auth 削除 */
  .delete('/me', async (c) => {
    const authUser = c.get('authUser');
    const body = deleteAccountBodySchema.parse(await c.req.json());
    await deleteAccount({
      authUserId: authUser.authUserId,
      reason: body.reason,
      ip: c.req.header('x-forwarded-for') ?? undefined,
      userAgent: c.req.header('user-agent') ?? undefined,
    });
    return c.json({ data: { ok: true } });
  });
