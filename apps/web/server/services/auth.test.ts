import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  syncUser as SyncUserType,
  completeSignup as CompleteSignupType,
  updateProfile as UpdateProfileType,
  getCurrentUser as GetCurrentUserType,
  recordLogin as RecordLoginType,
  deleteAccount as DeleteAccountType,
} from './auth.js';

// =============================================================================
// Mocks
// =============================================================================

const userStore: Record<string, MockUser> = {};
const oauthStore: MockOAuth[] = [];
const auditStore: MockAudit[] = [];

type MockUser = {
  id: string;
  authUserId: string;
  email: string;
  fullName: string;
  displayName: string;
  primaryAuthMethod: string;
  createdAt: Date;
  deletedAt: Date | null;
};
type MockOAuth = {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  email: string;
};
type MockAudit = {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  ip?: string | null;
  userAgent?: string | null;
  extra?: Record<string, unknown>;
};

let nextId = 1;
const newId = (prefix: string) => `${prefix}-${nextId++}`;

const userTx = {
  create: vi.fn(async ({ data }: { data: Omit<MockUser, 'id' | 'createdAt' | 'deletedAt'> }) => {
    const u: MockUser = {
      id: newId('u'),
      createdAt: new Date('2026-05-25T00:00:00Z'),
      deletedAt: null,
      ...data,
    };
    userStore[u.authUserId] = u;
    return u;
  }),
  // updateProfile 用。id で対象 user を引き、指定フィールドのみ上書きする。
  update: vi.fn(
    async ({ where, data }: { where: { id: string }; data: Partial<MockUser> }) => {
      const u = Object.values(userStore).find((x) => x.id === where.id);
      if (!u) throw new Error(`mock user not found: ${where.id}`);
      Object.assign(u, data);
      return u;
    },
  ),
};
const oauthTx = {
  create: vi.fn(async ({ data }: { data: Omit<MockOAuth, 'id'> }) => {
    const r: MockOAuth = { id: newId('o'), ...data };
    oauthStore.push(r);
    return r;
  }),
  deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
    const before = oauthStore.length;
    for (let i = oauthStore.length - 1; i >= 0; i--) {
      if (oauthStore[i]!.userId === where.userId) oauthStore.splice(i, 1);
    }
    return { count: before - oauthStore.length };
  }),
};
const auditTx = {
  create: vi.fn(async ({ data }: { data: Omit<MockAudit, 'id'> }) => {
    const r: MockAudit = { id: newId('a'), ...data };
    auditStore.push(r);
    return r;
  }),
};

const prismaMock = {
  user: {
    findUnique: vi.fn(async ({ where }: { where: { authUserId: string } }) => {
      return userStore[where.authUserId] ?? null;
    }),
    findFirst: vi.fn(async ({ where }: { where: { email: string; deletedAt: null } }) => {
      return Object.values(userStore).find(
        (u) => u.email === where.email && u.deletedAt === null,
      ) ?? null;
    }),
    // バッチ (配列) トランザクション用。tx 版と同一挙動。
    create: userTx.create,
    update: userTx.update,
  },
  oAuthIdentity: { create: oauthTx.create, deleteMany: oauthTx.deleteMany },
  auditLog: { create: auditTx.create },
  // 配列形式 ($transaction([...])) とコールバック形式 ($transaction(fn)) の両対応。
  $transaction: vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => Promise<unknown>)({
      user: userTx,
      oAuthIdentity: oauthTx,
      auditLog: auditTx,
    });
  }),
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

const getUserByIdMock = vi.fn();
const updateUserByIdMock = vi.fn(
  async (): Promise<{ data: { user: object | null }; error: { message: string } | null }> => ({
    data: { user: {} },
    error: null,
  }),
);
const deleteUserMock = vi.fn(
  async (): Promise<{ data: { user: object | null }; error: { message: string } | null }> => ({
    data: { user: {} },
    error: null,
  }),
);
vi.mock('../lib/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        getUserById: getUserByIdMock,
        updateUserById: updateUserByIdMock,
        deleteUser: deleteUserMock,
      },
    },
  }),
}));

// =============================================================================
// Tests
// =============================================================================

let syncUser: typeof SyncUserType;
let completeSignup: typeof CompleteSignupType;
let updateProfile: typeof UpdateProfileType;
let getCurrentUser: typeof GetCurrentUserType;
let recordLogin: typeof RecordLoginType;
let deleteAccount: typeof DeleteAccountType;

beforeAll(async () => {
  ({ syncUser, completeSignup, updateProfile, getCurrentUser, recordLogin, deleteAccount } =
    await import('./auth.js'));
});

afterEach(() => {
  for (const k of Object.keys(userStore)) delete userStore[k];
  oauthStore.length = 0;
  auditStore.length = 0;
  vi.clearAllMocks();
});

describe('syncUser', () => {
  it('returns ready when a users row already exists', async () => {
    userStore['auth-1'] = {
      id: 'u-pre',
      authUserId: 'auth-1',
      email: 'a@example.com',
      fullName: 'A',
      displayName: 'A',
      primaryAuthMethod: 'password',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
    };
    const res = await syncUser('auth-1', 'a@example.com');
    expect(res.status).toBe('ready');
    if (res.status === 'ready') expect(res.user.id).toBe('u-pre');
  });

  it('does not return ready for a soft-deleted row (falls through to provider sync)', async () => {
    userStore['auth-del'] = {
      id: 'u-del',
      authUserId: 'auth-del',
      email: 'deleted+u-del@trakon.invalid',
      fullName: '退会済みユーザー',
      displayName: '退会済みユーザー',
      primaryAuthMethod: 'password',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: new Date('2026-03-03T00:00:00Z'),
    };
    getUserByIdMock.mockResolvedValueOnce({
      data: {
        user: {
          email: 'new@example.com',
          app_metadata: { provider: 'email' },
          user_metadata: {},
          identities: [],
        },
      },
      error: null,
    });
    const res = await syncUser('auth-del', 'new@example.com');
    // ready ではなく provider 同期フローに流れる (締め出し)
    expect(res.status).toBe('requires_profile_completion');
  });

  it('returns requires_profile_completion for Magic-link provider', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      data: {
        user: {
          email: 'm@example.com',
          app_metadata: { provider: 'email' },
          user_metadata: {},
          identities: [],
        },
      },
      error: null,
    });
    const res = await syncUser('auth-magic', 'm@example.com');
    expect(res.status).toBe('requires_profile_completion');
    if (res.status === 'requires_profile_completion') {
      expect(res.email).toBe('m@example.com');
    }
  });

  it('creates user + oauth_identity for Google OAuth signup', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      data: {
        user: {
          email: 'g@example.com',
          app_metadata: { provider: 'google' },
          user_metadata: { full_name: 'Gina Example', name: 'Gina' },
          identities: [{ provider: 'google', id: 'google-sub-123' }],
        },
      },
      error: null,
    });
    const res = await syncUser('auth-g', 'g@example.com');
    expect(res.status).toBe('ready');
    if (res.status === 'ready') {
      expect(res.user.primaryAuthMethod).toBe('google');
      expect(res.user.fullName).toBe('Gina Example');
      expect(res.user.displayName).toBe('Gina');
    }
    expect(oauthStore).toHaveLength(1);
    expect(oauthStore[0]).toMatchObject({
      provider: 'google',
      providerUserId: 'google-sub-123',
      email: 'g@example.com',
    });
    // audit log は service 内では書かない (route 側 recordLogin で書く)
    expect(auditStore).toHaveLength(0);
  });

  it('maps Supabase azure provider to microsoft', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      data: {
        user: {
          email: 'm@msft.test',
          app_metadata: { provider: 'azure' },
          user_metadata: { name: 'M' },
          identities: [{ provider: 'azure', id: 'azure-sub-9' }],
        },
      },
      error: null,
    });
    const res = await syncUser('auth-m', 'm@msft.test');
    expect(res.status).toBe('ready');
    if (res.status === 'ready') expect(res.user.primaryAuthMethod).toBe('microsoft');
    expect(oauthStore[0]?.provider).toBe('microsoft');
  });

  it('throws 409 SAME_EMAIL_DIFFERENT_PROVIDER when email is taken by another provider', async () => {
    userStore['auth-existing'] = {
      id: 'u-existing',
      authUserId: 'auth-existing',
      email: 'shared@example.com',
      fullName: 'X',
      displayName: 'X',
      primaryAuthMethod: 'password',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
    };
    getUserByIdMock.mockResolvedValueOnce({
      data: {
        user: {
          email: 'shared@example.com',
          app_metadata: { provider: 'google' },
          user_metadata: {},
          identities: [{ provider: 'google', id: 'sub' }],
        },
      },
      error: null,
    });
    await expect(syncUser('auth-new', 'shared@example.com')).rejects.toMatchObject({
      code: 'SAME_EMAIL_DIFFERENT_PROVIDER',
      status: 409,
      details: { primaryAuthMethod: 'password' },
    });
  });
});

describe('completeSignup', () => {
  const input = {
    authUserId: 'auth-cs',
    email: 'cs@example.com',
    fullName: '河津 正和',
    displayName: 'Kawazu',
    password: 'Diag!Passw0rd123',
  };

  it('creates the user + audit log (batch transaction) and returns the DTO', async () => {
    const res = await completeSignup(input);

    expect(updateUserByIdMock).toHaveBeenCalledWith('auth-cs', { password: input.password });
    expect(res).toMatchObject({
      email: 'cs@example.com',
      fullName: '河津 正和',
      displayName: 'Kawazu',
      primaryAuthMethod: 'password',
    });
    // user 行と audit ログが同一 user id で作成される
    const stored = userStore['auth-cs'];
    expect(stored).toBeDefined();
    expect(res.id).toBe(stored?.id);
    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]).toMatchObject({
      actorUserId: res.id,
      action: 'complete_signup',
      resourceId: res.id,
      result: 'success',
    });
  });

  it('throws 409 ALREADY_COMPLETED when a users row already exists', async () => {
    userStore['auth-cs'] = {
      id: 'u-existing',
      authUserId: 'auth-cs',
      email: 'cs@example.com',
      fullName: 'X',
      displayName: 'X',
      primaryAuthMethod: 'password',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
    };
    await expect(completeSignup(input)).rejects.toMatchObject({
      code: 'ALREADY_COMPLETED',
      status: 409,
    });
  });

  it('throws 409 SAME_EMAIL_DIFFERENT_PROVIDER when the email is taken by another (OAuth) user', async () => {
    // 別 authUserId で同一メールの既存ユーザー (例: Google 登録済み) が存在するケース。
    userStore['auth-other'] = {
      id: 'u-other',
      authUserId: 'auth-other',
      email: 'cs@example.com',
      fullName: 'Other',
      displayName: 'Other',
      primaryAuthMethod: 'google',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
    };
    await expect(completeSignup(input)).rejects.toMatchObject({
      code: 'SAME_EMAIL_DIFFERENT_PROVIDER',
      status: 409,
      details: { primaryAuthMethod: 'google' },
    });
    // 衝突で弾かれたので user 行は作られない
    expect(userStore['auth-cs']).toBeUndefined();
  });

  it('throws 500 SUPABASE_UPDATE_FAILED when Supabase password update fails', async () => {
    updateUserByIdMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'password too weak' },
    });
    await expect(completeSignup(input)).rejects.toMatchObject({
      code: 'SUPABASE_UPDATE_FAILED',
      status: 500,
    });
    // Supabase 更新失敗時はトランザクションへ進まない
    expect(userStore['auth-cs']).toBeUndefined();
    expect(auditStore).toHaveLength(0);
  });
});

describe('updateProfile', () => {
  const seedUser = (overrides: Partial<MockUser> = {}) => {
    userStore['auth-up'] = {
      id: 'u-up',
      authUserId: 'auth-up',
      email: 'up@example.com',
      fullName: '旧 氏名',
      displayName: '旧表示名',
      primaryAuthMethod: 'password',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
      ...overrides,
    };
  };

  it('updates fullName / displayName and records an audit log', async () => {
    seedUser();
    const res = await updateProfile({
      authUserId: 'auth-up',
      fullName: '新 氏名',
      displayName: '新表示名',
    });

    expect(res).toMatchObject({ id: 'u-up', fullName: '新 氏名', displayName: '新表示名' });
    // パスワード未指定なので Supabase 側は呼ばれない
    expect(updateUserByIdMock).not.toHaveBeenCalled();
    expect(userStore['auth-up']?.fullName).toBe('新 氏名');
    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]).toMatchObject({
      actorUserId: 'u-up',
      action: 'update_profile',
      resourceId: 'u-up',
      result: 'success',
    });
  });

  it('updates the Supabase password when newPassword is given', async () => {
    seedUser();
    await updateProfile({ authUserId: 'auth-up', newPassword: 'N3w!Passw0rd456' });
    expect(updateUserByIdMock).toHaveBeenCalledWith('auth-up', { password: 'N3w!Passw0rd456' });
  });

  it('throws 404 PROFILE_NOT_COMPLETED when the user does not exist', async () => {
    await expect(
      updateProfile({ authUserId: 'auth-missing', fullName: 'X' }),
    ).rejects.toMatchObject({ code: 'PROFILE_NOT_COMPLETED', status: 404 });
  });

  it('throws 500 SUPABASE_UPDATE_FAILED when the Supabase password update fails', async () => {
    seedUser();
    updateUserByIdMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'rejected' },
    });
    await expect(
      updateProfile({ authUserId: 'auth-up', newPassword: 'bad' }),
    ).rejects.toMatchObject({ code: 'SUPABASE_UPDATE_FAILED', status: 500 });
    // 更新は走らず audit も書かれない
    expect(auditStore).toHaveLength(0);
  });
});

describe('getCurrentUser', () => {
  it('returns the DTO when the user exists', async () => {
    userStore['auth-gc'] = {
      id: 'u-gc',
      authUserId: 'auth-gc',
      email: 'gc@example.com',
      fullName: 'GC',
      displayName: 'GC',
      primaryAuthMethod: 'google',
      createdAt: new Date('2026-02-02T00:00:00Z'),
      deletedAt: null,
    };
    const res = await getCurrentUser('auth-gc');
    expect(res).toMatchObject({
      id: 'u-gc',
      email: 'gc@example.com',
      primaryAuthMethod: 'google',
      createdAt: '2026-02-02T00:00:00.000Z',
    });
  });

  it('returns null when the user does not exist', async () => {
    expect(await getCurrentUser('auth-none')).toBeNull();
  });

  it('returns null for a soft-deleted (withdrawn) user', async () => {
    userStore['auth-del'] = {
      id: 'u-del',
      authUserId: 'auth-del',
      email: 'deleted+u-del@trakon.invalid',
      fullName: '退会済みユーザー',
      displayName: '退会済みユーザー',
      primaryAuthMethod: 'password',
      createdAt: new Date('2026-02-02T00:00:00Z'),
      deletedAt: new Date('2026-03-03T00:00:00Z'),
    };
    expect(await getCurrentUser('auth-del')).toBeNull();
  });
});

describe('deleteAccount', () => {
  const seed = (overrides: Partial<MockUser> = {}) => {
    userStore['auth-del'] = {
      id: 'u-del',
      authUserId: 'auth-del',
      email: 'bye@example.com',
      fullName: '河津 正和',
      displayName: 'Kawazu',
      primaryAuthMethod: 'password',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
      ...overrides,
    };
  };

  it('soft-deletes + anonymizes the user, removes oauth, logs the reason, deletes the Supabase auth user', async () => {
    seed({ primaryAuthMethod: 'google' });
    oauthStore.push({
      id: 'o-1',
      userId: 'u-del',
      provider: 'google',
      providerUserId: 'google-sub',
      email: 'bye@example.com',
    });

    await deleteAccount({
      authUserId: 'auth-del',
      reason: 'switching_tool',
      ip: '203.0.113.9',
      userAgent: 'jest-UA',
    });

    const stored = userStore['auth-del'];
    expect(stored?.deletedAt).toBeInstanceOf(Date);
    expect(stored?.email).toBe('deleted+u-del@trakon.invalid');
    expect(stored?.fullName).toBe('退会済みユーザー');
    expect(stored?.displayName).toBe('退会済みユーザー');
    // oauth_identities は物理削除
    expect(oauthStore).toHaveLength(0);
    // 監査ログに退会理由を残す
    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]).toMatchObject({
      actorUserId: 'u-del',
      action: 'account_delete',
      resourceType: 'user',
      resourceId: 'u-del',
      result: 'success',
      extra: { reason: 'switching_tool' },
      ip: '203.0.113.9',
      userAgent: 'jest-UA',
    });
    // Supabase Auth ユーザーも削除
    expect(deleteUserMock).toHaveBeenCalledWith('auth-del');
  });

  it('throws 404 PROFILE_NOT_COMPLETED when the user does not exist', async () => {
    await expect(
      deleteAccount({ authUserId: 'auth-missing', reason: 'other' }),
    ).rejects.toMatchObject({ code: 'PROFILE_NOT_COMPLETED', status: 404 });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('throws 404 when the user is already withdrawn (deletedAt set)', async () => {
    seed({ deletedAt: new Date('2026-02-02T00:00:00Z') });
    await expect(
      deleteAccount({ authUserId: 'auth-del', reason: 'other' }),
    ).rejects.toMatchObject({ code: 'PROFILE_NOT_COMPLETED', status: 404 });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('throws 500 SUPABASE_DELETE_FAILED but keeps the Prisma soft-delete committed', async () => {
    seed();
    deleteUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'supabase down' },
    });
    await expect(
      deleteAccount({ authUserId: 'auth-del', reason: 'not_using' }),
    ).rejects.toMatchObject({ code: 'SUPABASE_DELETE_FAILED', status: 500 });
    // Prisma は先にコミット済みなので論理削除は残る (締め出し済み)
    expect(userStore['auth-del']?.deletedAt).toBeInstanceOf(Date);
    expect(auditStore).toHaveLength(1);
  });
});

describe('recordLogin', () => {
  it('writes a login audit log with ip / userAgent', async () => {
    await recordLogin({ userId: 'u-1', ip: '203.0.113.7', userAgent: 'jest-UA' });
    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]).toMatchObject({
      actorUserId: 'u-1',
      action: 'login',
      resourceType: 'user',
      resourceId: 'u-1',
      result: 'success',
      ip: '203.0.113.7',
      userAgent: 'jest-UA',
    });
  });

  it('defaults ip / userAgent to null when omitted', async () => {
    await recordLogin({ userId: 'u-2' });
    expect(auditStore[0]).toMatchObject({ ip: null, userAgent: null });
  });

  it('swallows write errors (best-effort, non-fatal)', async () => {
    auditTx.create.mockRejectedValueOnce(new Error('db down'));
    // 例外を投げずに解決すること
    await expect(recordLogin({ userId: 'u-3' })).resolves.toBeUndefined();
    expect(auditStore).toHaveLength(0);
  });
});
