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

type TrakonProvider = 'google' | 'microsoft';

function toTrakonProvider(supabaseProvider: string): TrakonProvider | null {
  if (supabaseProvider === 'google') return 'google';
  if (supabaseProvider === 'azure') return 'microsoft';
  return null;
}

function deriveOAuthNames(meta: Record<string, unknown>, email: string) {
  const localPart = email.split('@')[0] ?? email;
  const full =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    localPart;
  const display = (typeof meta.name === 'string' && meta.name) || full;
  return {
    fullName: full.slice(0, 100),
    displayName: display.slice(0, 50),
  };
}

/**
 * Supabase auth.users と public.users を同期する。
 * - users 行があれば返す
 * - 無ければ provider に応じて
 *   - 'email' / 'magiclink' → `requires_profile_completion` を返す
 *     (FE は SC-01 の create-account に遷移し complete-signup を呼ぶ)
 *   - 'google' / 'azure' → users + oauth_identities + audit_logs を 1 トランザクションで INSERT
 *     (FR-AUTH-12: 同一メール別プロバイダは 409)
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
  const supabaseProvider = data.user.app_metadata?.provider ?? 'email';
  const trakonProvider = toTrakonProvider(supabaseProvider);

  if (!trakonProvider) {
    // Magic-link / password / etc.
    return { status: 'requires_profile_completion', email };
  }

  // OAuth フロー
  // 同一メール別プロバイダ衝突チェック (FR-AUTH-12)
  const emailOwner = await prisma.user.findFirst({
    where: { email, deletedAt: null },
  });
  if (emailOwner && emailOwner.primaryAuthMethod !== trakonProvider) {
    throw new ApiException(
      'SAME_EMAIL_DIFFERENT_PROVIDER',
      409,
      `Email is already registered with ${emailOwner.primaryAuthMethod}.`,
      { primaryAuthMethod: emailOwner.primaryAuthMethod },
    );
  }

  // provider 由来 subject
  const identity = data.user.identities?.find((i) => i.provider === supabaseProvider);
  if (!identity) {
    throw new ApiException('OAUTH_IDENTITY_NOT_FOUND', 500, 'Provider identity not found.');
  }
  const providerUserId = identity.id;
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const { fullName, displayName } = deriveOAuthNames(meta, email);

  // audit_logs の login 記録はルート側 recordLogin で書く (重複防止)
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        authUserId,
        email,
        fullName,
        displayName,
        primaryAuthMethod: trakonProvider,
      },
    });
    await tx.oAuthIdentity.create({
      data: {
        userId: user.id,
        provider: trakonProvider,
        providerUserId,
        email,
      },
    });
    return user;
  });

  return { status: 'ready', user: toDTO(created) };
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

/**
 * プロフィール / 認証情報を更新する。
 * - newPassword: Supabase Auth 側を admin 更新 (completeSignup と同方針)
 * - fullName / displayName: public.users を更新
 * いずれも任意。1 件以上の指定はスキーマで担保。
 */
export async function updateProfile(input: {
  authUserId: string;
  fullName?: string;
  displayName?: string;
  newPassword?: string;
}): Promise<CurrentUserDTO> {
  const existing = await prisma.user.findUnique({ where: { authUserId: input.authUserId } });
  if (!existing) {
    throw new ApiException('PROFILE_NOT_COMPLETED', 404, 'User profile not found.');
  }

  if (input.newPassword) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.auth.admin.updateUserById(input.authUserId, {
      password: input.newPassword,
    });
    if (error) {
      throw new ApiException('SUPABASE_UPDATE_FAILED', 500, error.message);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: existing.id },
      data: {
        ...(input.fullName !== undefined && { fullName: input.fullName }),
        ...(input.displayName !== undefined && { displayName: input.displayName }),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: u.id,
        action: 'update_profile',
        resourceType: 'user',
        resourceId: u.id,
        result: 'success',
      },
    });
    return u;
  });

  return toDTO(updated);
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
