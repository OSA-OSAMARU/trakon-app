import { prisma } from '@trakon/db';
import type { WithdrawalReason } from '@trakon/shared';
import { uuidv7 } from 'uuidv7';

import { ApiException } from '../lib/errors.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';

/**
 * 個々の await をハードタイムアウトで包む。サーバーレスの 30 秒無音ハングを根絶し、
 * どのステップで詰まったかをレスポンス body から即特定できるようにする
 * (実体の処理はキャンセルされないが制御を即返す)。
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ApiException('STEP_TIMEOUT', 504, `Operation timed out at: ${label}`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

const STEP_TIMEOUT_MS = 10_000;

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
  // 退会済み (deletedAt) は未存在として扱い、ready を返さない (締め出し)。
  if (existing && !existing.deletedAt) {
    // メールアドレス変更 (#129) の同期。パスワードユーザーが Supabase 組み込みの
    // email 変更フロー (updateUser({ email }) → 新旧両アドレス確認) を完了すると
    // auth.users.email が変わり JWT の email クレームも新メールになる。public.users.email は
    // ここで追随させる (webhook を使わず、次回 sync でリコンサイルする)。
    const reconciled = await reconcileEmailIfChanged(existing, jwtEmail);
    return { status: 'ready', user: toDTO(reconciled) };
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

type UserRow = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;

/**
 * JWT (= auth.users) の email が public.users.email と食い違う場合に追随させる (#129)。
 * メールアドレス変更フロー (Supabase 組み込み) 完了後の同期点。変更が無ければ何もしない。
 *
 * email は @unique。理論上 auth.users 側でも一意なので衝突しないが、万一の一意制約違反
 * (P2002) では sync 自体を落とさず旧行のまま返す (ログインを止めない best-effort 同期)。
 */
async function reconcileEmailIfChanged(user: UserRow, jwtEmail: string): Promise<UserRow> {
  if (!jwtEmail || user.email.toLowerCase() === jwtEmail.toLowerCase()) {
    return user;
  }
  const previousEmail = user.email;
  try {
    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { email: jwtEmail },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'email_changed',
          resourceType: 'user',
          resourceId: user.id,
          result: 'success',
          extra: { previousEmail },
        },
      }),
    ]);
    return updated;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      console.error('[syncUser] email reconcile skipped (unique conflict):', jwtEmail);
      return user;
    }
    throw err;
  }
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
  // 各ステップの所要時間を計測し、どこで滞留するかを Vercel ログから特定できるようにする。
  const t0 = Date.now();
  const step = (name: string) => console.log(`[completeSignup] ${name} +${Date.now() - t0}ms`);

  step('findUnique:start');
  const existing = await withTimeout(
    prisma.user.findUnique({ where: { authUserId: input.authUserId } }),
    STEP_TIMEOUT_MS,
    'findUnique',
  );
  step('findUnique:done');
  if (existing) {
    throw new ApiException('ALREADY_COMPLETED', 409, 'Signup is already completed.');
  }

  // 同一メール別プロバイダ衝突 (FR-AUTH-12)
  step('findFirst:start');
  const emailOwner = await withTimeout(
    prisma.user.findFirst({ where: { email: input.email, deletedAt: null } }),
    STEP_TIMEOUT_MS,
    'findFirst',
  );
  step('findFirst:done');
  if (emailOwner) {
    throw new ApiException(
      'SAME_EMAIL_DIFFERENT_PROVIDER',
      409,
      `Email is already registered with ${emailOwner.primaryAuthMethod}.`,
      { primaryAuthMethod: emailOwner.primaryAuthMethod },
    );
  }

  const supabase = getSupabaseAdmin();
  step('supabase.updateUserById:start');
  const { error: updateError } = await withTimeout(
    supabase.auth.admin.updateUserById(input.authUserId, { password: input.password }),
    STEP_TIMEOUT_MS,
    'supabase.updateUserById',
  );
  step('supabase.updateUserById:done');
  if (updateError) {
    throw new ApiException('SUPABASE_UPDATE_FAILED', 500, updateError.message);
  }

  // 対話的トランザクションは Supabase の Transaction モードプーラで接続を保持し続けて滞留しやすい。
  // id をアプリ側で採番し、依存のないバッチ (配列) トランザクションで 1 往復に収める。
  step('transaction:start');
  const userId = uuidv7();
  const [user] = await withTimeout(
    prisma.$transaction([
      prisma.user.create({
        data: {
          id: userId,
          authUserId: input.authUserId,
          email: input.email,
          fullName: input.fullName,
          displayName: input.displayName,
          primaryAuthMethod: 'password',
        },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'complete_signup',
          resourceType: 'user',
          resourceId: userId,
          result: 'success',
        },
      }),
    ]),
    STEP_TIMEOUT_MS,
    'transaction',
  );
  step('transaction:done');

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
  if (!existing || existing.deletedAt) {
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
  // 退会済み (deletedAt) は未存在として扱う (締め出し)。
  return user && !user.deletedAt ? toDTO(user) : null;
}

/**
 * 退会 (アカウント削除) を行う (issue #95)。物理削除は Project.createdBy の Restrict
 * 制約で不可なため、論理削除 (deletedAt) + 個人情報の匿名化 + Supabase Auth ユーザー削除
 * で実現する。
 * - users: deletedAt をセットし email / fullName / displayName を匿名化
 *   (email @unique を維持したまま同一メールでの再登録を可能にする)
 * - oauth_identities: 物理削除 (再登録時の uq_oauth_identities_* 衝突を回避。
 *   Supabase 側 auth ユーザーも削除するため整合する)
 * - audit_logs: account_delete を退会理由 (extra.reason) 付きで記録
 *
 * 整合性のため Prisma を先にコミットしてから Supabase Auth を削除する。Supabase 削除が
 * 失敗しても論理削除済みで締め出しガード (getCurrentUser / attachCurrentUserId) が効くため
 * リカバリ可能。
 */
export async function deleteAccount(input: {
  authUserId: string;
  reason: WithdrawalReason;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  const existing = await withTimeout(
    prisma.user.findUnique({ where: { authUserId: input.authUserId } }),
    STEP_TIMEOUT_MS,
    'findUnique',
  );
  if (!existing || existing.deletedAt) {
    throw new ApiException('PROFILE_NOT_COMPLETED', 404, 'User profile not found.');
  }

  await withTimeout(
    prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: {
          deletedAt: new Date(),
          email: `deleted+${existing.id}@trakon.invalid`,
          fullName: '退会済みユーザー',
          displayName: '退会済みユーザー',
        },
      }),
      prisma.oAuthIdentity.deleteMany({ where: { userId: existing.id } }),
      prisma.auditLog.create({
        data: {
          actorUserId: existing.id,
          action: 'account_delete',
          resourceType: 'user',
          resourceId: existing.id,
          result: 'success',
          extra: { reason: input.reason },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
      }),
    ]),
    STEP_TIMEOUT_MS,
    'transaction',
  );

  // Supabase Auth ユーザーを削除し、再ログインを物理的に不可にする。
  // Prisma は既にコミット済みのため、ここで失敗してもデータ整合は保たれる。
  const supabase = getSupabaseAdmin();
  const { error } = await withTimeout(
    supabase.auth.admin.deleteUser(input.authUserId),
    STEP_TIMEOUT_MS,
    'supabase.deleteUser',
  );
  if (error) {
    throw new ApiException('SUPABASE_DELETE_FAILED', 500, error.message);
  }
}

export async function recordLogin(input: {
  userId: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  // ログイン監査は best-effort。書き込みが失敗/遅延しても認証フロー (login / complete-signup) の
  // レスポンスを止めない (id はクライアント採番 = uuid(7) なので DB 関数依存の滞留も避けられる)。
  try {
    await withTimeout(
      prisma.auditLog.create({
        data: {
          actorUserId: input.userId,
          action: 'login',
          resourceType: 'user',
          resourceId: input.userId,
          result: 'success',
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
      }),
      STEP_TIMEOUT_MS,
      'recordLogin',
    );
  } catch (err) {
    console.error('[recordLogin] failed (non-fatal):', err);
  }
}
