import { prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';

export type CurrentUserDTO = {
  id: string;
  email: string;
  fullName: string;
  displayName: string;
  primaryAuthMethod: 'password' | 'google' | 'microsoft';
  createdAt: string;
};

export type SyncResult =
  | { status: 'ready'; user: CurrentUserDTO }
  | { status: 'requires_profile_completion'; email: string };

function toDTO(user: {
  id: string;
  email: string;
  fullName: string;
  displayName: string;
  primaryAuthMethod: string;
  createdAt: Date;
}): CurrentUserDTO {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    displayName: user.displayName,
    primaryAuthMethod: user.primaryAuthMethod as CurrentUserDTO['primaryAuthMethod'],
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Supabase auth.users と public.users を同期する。
 * - users 行があれば返す
 * - 無ければ provider に応じて
 *   - 'email' / 'magiclink' → `requires_profile_completion` を返す
 *     (FE は SC-01 の create-account に遷移し complete-signup を呼ぶ)
 *   - 'google' / 'azure' → Sub-Phase 0.1 後半で実装。今は 422 を返す
 */
export async function syncUser(authUserId: string, jwtEmail: string): Promise<SyncResult> {
  const existing = await prisma.user.findUnique({ where: { authUserId } });
  if (existing) {
    return { status: 'ready', user: toDTO(existing) };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.admin.getUserById(authUserId);
  if (error || !data.user) {
    throw new ApiException('AUTH_INVALID', 401, 'Supabase auth user not found.');
  }
  const email = data.user.email ?? jwtEmail;
  const provider = data.user.app_metadata?.provider ?? 'email';

  if (provider === 'google' || provider === 'azure') {
    // Sub-Phase 0.1 後半 (OAuth) で実装予定
    throw new ApiException(
      'OAUTH_SIGNUP_NOT_IMPLEMENTED',
      422,
      'OAuth signup will be available in the next release.',
    );
  }

  return { status: 'requires_profile_completion', email };
}

/**
 * Magic-link サインアップの詳細入力を受け、users 行を INSERT し
 * Supabase Auth 側にパスワードを設定する。同一トランザクション内で監査ログを記録。
 */
export async function completeSignup(input: {
  authUserId: string;
  email: string;
  fullName: string;
  displayName: string;
  password: string;
}): Promise<CurrentUserDTO> {
  const existing = await prisma.user.findUnique({ where: { authUserId: input.authUserId } });
  if (existing) {
    throw new ApiException('ALREADY_COMPLETED', 409, 'Signup is already completed.');
  }

  // 同一メール別プロバイダ衝突 (FR-AUTH-12)
  const emailOwner = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
  });
  if (emailOwner) {
    throw new ApiException(
      'SAME_EMAIL_DIFFERENT_PROVIDER',
      409,
      `Email is already registered with ${emailOwner.primaryAuthMethod}.`,
      { primaryAuthMethod: emailOwner.primaryAuthMethod },
    );
  }

  const supabase = getSupabaseAdmin();
  const { error: updateError } = await supabase.auth.admin.updateUserById(input.authUserId, {
    password: input.password,
  });
  if (updateError) {
    throw new ApiException('SUPABASE_UPDATE_FAILED', 500, updateError.message);
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        authUserId: input.authUserId,
        email: input.email,
        fullName: input.fullName,
        displayName: input.displayName,
        primaryAuthMethod: 'password',
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: created.id,
        action: 'complete_signup',
        resourceType: 'user',
        resourceId: created.id,
        result: 'success',
      },
    });
    return created;
  });

  return toDTO(user);
}

export async function getCurrentUser(authUserId: string): Promise<CurrentUserDTO | null> {
  const user = await prisma.user.findUnique({ where: { authUserId } });
  return user ? toDTO(user) : null;
}

export async function recordLogin(input: {
  userId: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.userId,
      action: 'login',
      resourceType: 'user',
      resourceId: input.userId,
      result: 'success',
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
