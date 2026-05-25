import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { syncUser as SyncUserType } from './auth.js';

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
};
const oauthTx = {
  create: vi.fn(async ({ data }: { data: Omit<MockOAuth, 'id'> }) => {
    const r: MockOAuth = { id: newId('o'), ...data };
    oauthStore.push(r);
    return r;
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
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ user: userTx, oAuthIdentity: oauthTx, auditLog: auditTx });
  }),
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

const getUserByIdMock = vi.fn();
vi.mock('../lib/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { getUserById: getUserByIdMock, updateUserById: vi.fn() } },
  }),
}));

// =============================================================================
// Tests
// =============================================================================

let syncUser: typeof SyncUserType;

beforeAll(async () => {
  ({ syncUser } = await import('./auth.js'));
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
