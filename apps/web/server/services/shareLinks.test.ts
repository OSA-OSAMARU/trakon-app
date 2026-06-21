import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { hashToken } from '../lib/tokens.js';
import type {
  listShareLinks as ListType,
  createShareLink as CreateType,
  revokeShareLink as RevokeType,
  findActiveShareLinkByRawToken as FindActiveType,
  touchShareLinkAccess as TouchType,
} from './shareLinks.js';

// =============================================================================
// Mocks
// =============================================================================

type MockShareLink = {
  id: string;
  projectId: string;
  scopeType: string;
  scopeTargetId: string | null;
  tokenHash: string;
  issuedByMemberId: string;
  issuedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastAccessedAt: Date | null;
};
type MockItem = { id: string; projectId: string; deletedAt: Date | null };
type MockPlan = {
  id: string;
  deletedAt: Date | null;
  item: { projectId: string };
};
type MockAudit = Record<string, unknown>;

const shareLinkStore: MockShareLink[] = [];
const itemStore: MockItem[] = [];
const planStore: MockPlan[] = [];
const auditStore: MockAudit[] = [];

let nextId = 1;
const newId = (prefix: string) => `${prefix}-${nextId++}`;

// shareLink.update は $transaction の配列形式から呼ばれるため、
// Prisma 同様「呼び出し時点で Promise を生成」する形にする。
const shareLinkUpdate = vi.fn(
  ({ where, data }: { where: { id: string }; data: Partial<MockShareLink> }) => {
    const row = shareLinkStore.find((r) => r.id === where.id);
    if (!row) return Promise.reject(new Error('record not found'));
    Object.assign(row, data);
    return Promise.resolve({ ...row });
  },
);

const auditCreate = vi.fn(({ data }: { data: MockAudit }) => {
  const r = { id: newId('a'), ...data };
  auditStore.push(r);
  return Promise.resolve(r);
});

const prismaMock = {
  shareLink: {
    findMany: vi.fn(
      async ({ where }: { where: { projectId: string } }) => {
        // issuedAt desc 相当 (新しい順)
        return shareLinkStore
          .filter((r) => r.projectId === where.projectId)
          .slice()
          .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
          .map((r) => ({ ...r }));
      },
    ),
    findFirst: vi.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        // revoke: { id, projectId } / findActive: { tokenHash, revokedAt: null, OR: [...] }
        if ('tokenHash' in where) {
          const now = Date.now();
          const row = shareLinkStore.find(
            (r) =>
              r.tokenHash === where.tokenHash &&
              r.revokedAt === null &&
              (r.expiresAt === null || r.expiresAt.getTime() > now),
          );
          return row ? { ...row } : null;
        }
        const row = shareLinkStore.find(
          (r) => r.id === where.id && r.projectId === where.projectId,
        );
        return row ? { ...row } : null;
      },
    ),
    create: vi.fn(
      async ({ data }: { data: Omit<MockShareLink, 'id' | 'issuedAt' | 'revokedAt' | 'lastAccessedAt'> & Partial<MockShareLink> }) => {
        const row: MockShareLink = {
          id: newId('sl'),
          issuedAt: new Date('2026-06-21T00:00:00Z'),
          revokedAt: null,
          lastAccessedAt: null,
          ...data,
        } as MockShareLink;
        shareLinkStore.push(row);
        return { ...row };
      },
    ),
    update: shareLinkUpdate,
  },
  projectItem: {
    findFirst: vi.fn(
      async ({ where }: { where: { id: string; projectId: string; deletedAt: null } }) => {
        const row = itemStore.find(
          (i) => i.id === where.id && i.projectId === where.projectId && i.deletedAt === null,
        );
        return row ? { id: row.id } : null;
      },
    ),
  },
  plan: {
    findFirst: vi.fn(
      async ({ where }: { where: { id: string; deletedAt: null } }) => {
        const row = planStore.find((p) => p.id === where.id && p.deletedAt === null);
        return row ? { ...row } : null;
      },
    ),
  },
  auditLog: { create: auditCreate },
  // revokeShareLink は配列形式 ($transaction([...])) のみ使用。
  $transaction: vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => Promise<unknown>)(prismaMock);
  }),
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// env フォールバック検証用。既定では呼ばれない (baseUrl を渡すため)。
const getServerEnvMock = vi.fn(() => ({ PUBLIC_APP_URL: 'https://env.example' }));
vi.mock('../lib/env.js', () => ({ getServerEnv: getServerEnvMock }));

// =============================================================================
// Tests
// =============================================================================

let listShareLinks: typeof ListType;
let createShareLink: typeof CreateType;
let revokeShareLink: typeof RevokeType;
let findActiveShareLinkByRawToken: typeof FindActiveType;
let touchShareLinkAccess: typeof TouchType;

beforeAll(async () => {
  ({
    listShareLinks,
    createShareLink,
    revokeShareLink,
    findActiveShareLinkByRawToken,
    touchShareLinkAccess,
  } = await import('./shareLinks.js'));
});

afterEach(() => {
  shareLinkStore.length = 0;
  itemStore.length = 0;
  planStore.length = 0;
  auditStore.length = 0;
  vi.clearAllMocks();
});

const baseUrl = 'https://app.test';

describe('createShareLink', () => {
  it('project スコープ: scopeTargetId は null・active DTO・生トークン URL を返す', async () => {
    const res = await createShareLink({
      projectId: 'p-1',
      issuerMemberId: 'm-1',
      baseUrl,
      body: { scopeType: 'project', expiresInHours: 168 },
    });

    expect(res.shareLink).toMatchObject({
      projectId: 'p-1',
      scopeType: 'project',
      scopeTargetId: null,
      issuedByMemberId: 'm-1',
      status: 'active',
      revokedAt: null,
    });
    expect(res.shareLink.expiresAt).not.toBeNull();
    expect(res.rawToken).toEqual(expect.any(String));
    expect(res.url).toBe(`${baseUrl}/share/${res.rawToken}`);
    // DB には生トークンではなくハッシュが保存される
    expect(shareLinkStore[0]?.tokenHash).toBe(hashToken(res.rawToken));
    // 監査ログ share_create
    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]).toMatchObject({
      action: 'share_create',
      resourceType: 'share_link',
      result: 'success',
      shareLinkId: shareLinkStore[0]?.id,
    });
    // project スコープでは projectItem / plan 検証は走らない
    expect(prismaMock.projectItem.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.plan.findFirst).not.toHaveBeenCalled();
  });

  it('expiresInHours が null なら無期限 (expiresAt = null)', async () => {
    const res = await createShareLink({
      projectId: 'p-1',
      issuerMemberId: 'm-1',
      baseUrl,
      body: { scopeType: 'project', expiresInHours: null },
    });
    expect(res.shareLink.expiresAt).toBeNull();
    expect(res.shareLink.status).toBe('active');
  });

  it('item スコープ: 同一プロジェクト配下の item があれば作成成功', async () => {
    itemStore.push({ id: 'i-1', projectId: 'p-1', deletedAt: null });
    const res = await createShareLink({
      projectId: 'p-1',
      issuerMemberId: 'm-1',
      baseUrl,
      body: { scopeType: 'item', scopeTargetId: 'i-1', expiresInHours: 168 },
    });
    expect(res.shareLink).toMatchObject({ scopeType: 'item', scopeTargetId: 'i-1' });
  });

  it('item スコープ: item が見つからなければ 422 SCOPE_NOT_FOUND', async () => {
    await expect(
      createShareLink({
        projectId: 'p-1',
        issuerMemberId: 'm-1',
        baseUrl,
        body: { scopeType: 'item', scopeTargetId: 'i-missing', expiresInHours: 168 },
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_NOT_FOUND', status: 422 });
  });

  it('plan スコープ: 同一プロジェクト配下の plan があれば作成成功', async () => {
    planStore.push({ id: 'pl-1', deletedAt: null, item: { projectId: 'p-1' } });
    const res = await createShareLink({
      projectId: 'p-1',
      issuerMemberId: 'm-1',
      baseUrl,
      body: { scopeType: 'plan', scopeTargetId: 'pl-1', expiresInHours: 168 },
    });
    expect(res.shareLink).toMatchObject({ scopeType: 'plan', scopeTargetId: 'pl-1' });
  });

  it('plan スコープ: plan 未存在なら 422 SCOPE_NOT_FOUND', async () => {
    await expect(
      createShareLink({
        projectId: 'p-1',
        issuerMemberId: 'm-1',
        baseUrl,
        body: { scopeType: 'plan', scopeTargetId: 'pl-missing', expiresInHours: 168 },
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_NOT_FOUND', status: 422 });
  });

  it('plan スコープ: plan が別プロジェクト配下なら 422 SCOPE_NOT_FOUND', async () => {
    planStore.push({ id: 'pl-other', deletedAt: null, item: { projectId: 'p-OTHER' } });
    await expect(
      createShareLink({
        projectId: 'p-1',
        issuerMemberId: 'm-1',
        baseUrl,
        body: { scopeType: 'plan', scopeTargetId: 'pl-other', expiresInHours: 168 },
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_NOT_FOUND', status: 422 });
  });

  it('baseUrl 未指定なら getServerEnv().PUBLIC_APP_URL をフォールバック使用', async () => {
    const res = await createShareLink({
      projectId: 'p-1',
      issuerMemberId: 'm-1',
      body: { scopeType: 'project', expiresInHours: 168 },
    });
    expect(getServerEnvMock).toHaveBeenCalled();
    expect(res.url).toBe(`https://env.example/share/${res.rawToken}`);
  });
});

describe('listShareLinks', () => {
  it('issuedAt 降順で全件を DTO 化して返す', async () => {
    shareLinkStore.push(
      {
        id: 'sl-old',
        projectId: 'p-1',
        scopeType: 'project',
        scopeTargetId: null,
        tokenHash: 'h1',
        issuedByMemberId: 'm-1',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
      {
        id: 'sl-new',
        projectId: 'p-1',
        scopeType: 'project',
        scopeTargetId: null,
        tokenHash: 'h2',
        issuedByMemberId: 'm-1',
        issuedAt: new Date('2026-03-01T00:00:00Z'),
        // 過去日 → expired
        expiresAt: new Date('2026-03-02T00:00:00Z'),
        revokedAt: null,
        lastAccessedAt: new Date('2026-03-01T01:00:00Z'),
      },
      // 別プロジェクト → 含まれない
      {
        id: 'sl-other',
        projectId: 'p-2',
        scopeType: 'project',
        scopeTargetId: null,
        tokenHash: 'h3',
        issuedByMemberId: 'm-9',
        issuedAt: new Date('2026-04-01T00:00:00Z'),
        expiresAt: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
    );
    const rows = await listShareLinks('p-1');
    expect(rows.map((r) => r.id)).toEqual(['sl-new', 'sl-old']);
    expect(rows[0]).toMatchObject({ status: 'expired', lastAccessedAt: expect.any(String) });
    expect(rows[1]).toMatchObject({ status: 'active' });
  });

  it('revoked な行は status=revoked になる', async () => {
    shareLinkStore.push({
      id: 'sl-r',
      projectId: 'p-1',
      scopeType: 'project',
      scopeTargetId: null,
      tokenHash: 'h',
      issuedByMemberId: 'm-1',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      revokedAt: new Date('2026-02-01T00:00:00Z'),
      lastAccessedAt: null,
    });
    const rows = await listShareLinks('p-1');
    expect(rows[0]).toMatchObject({ status: 'revoked', revokedAt: expect.any(String) });
  });
});

describe('revokeShareLink', () => {
  const seedActive = () => {
    shareLinkStore.push({
      id: 'sl-1',
      projectId: 'p-1',
      scopeType: 'project',
      scopeTargetId: null,
      tokenHash: 'h',
      issuedByMemberId: 'm-1',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
    });
  };

  it('active なリンクを revoke し、revokedAt を設定・監査ログを書く', async () => {
    seedActive();
    await revokeShareLink({ projectId: 'p-1', shareLinkId: 'sl-1', actorUserId: 'u-1' });
    expect(shareLinkStore[0]?.revokedAt).toBeInstanceOf(Date);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]).toMatchObject({
      actorUserId: 'u-1',
      action: 'share_revoke',
      resourceType: 'share_link',
      resourceId: 'sl-1',
      result: 'success',
    });
  });

  it('既に revoked 済みなら no-op (トランザクションを実行しない)', async () => {
    shareLinkStore.push({
      id: 'sl-1',
      projectId: 'p-1',
      scopeType: 'project',
      scopeTargetId: null,
      tokenHash: 'h',
      issuedByMemberId: 'm-1',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      revokedAt: new Date('2026-02-01T00:00:00Z'),
      lastAccessedAt: null,
    });
    await revokeShareLink({ projectId: 'p-1', shareLinkId: 'sl-1', actorUserId: 'u-1' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditStore).toHaveLength(0);
  });

  it('存在しない / 別プロジェクトのリンクは 404 NOT_FOUND', async () => {
    seedActive();
    await expect(
      revokeShareLink({ projectId: 'p-OTHER', shareLinkId: 'sl-1', actorUserId: 'u-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('findActiveShareLinkByRawToken', () => {
  it('生トークンを SHA-256 でハッシュ化して active な行を引く', async () => {
    const raw = 'raw-token-abc';
    shareLinkStore.push({
      id: 'sl-1',
      projectId: 'p-1',
      scopeType: 'project',
      scopeTargetId: null,
      tokenHash: hashToken(raw),
      issuedByMemberId: 'm-1',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
    });
    const row = await findActiveShareLinkByRawToken(raw);
    expect(row.id).toBe('sl-1');
  });

  it('期限切れ / revoked / 未存在は 404 SHARE_NOT_FOUND_OR_EXPIRED に集約', async () => {
    // revoked
    shareLinkStore.push({
      id: 'sl-r',
      projectId: 'p-1',
      scopeType: 'project',
      scopeTargetId: null,
      tokenHash: hashToken('revoked-raw'),
      issuedByMemberId: 'm-1',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      revokedAt: new Date('2026-02-01T00:00:00Z'),
      lastAccessedAt: null,
    });
    await expect(findActiveShareLinkByRawToken('revoked-raw')).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
    // 未存在
    await expect(findActiveShareLinkByRawToken('nope')).rejects.toMatchObject({
      code: 'SHARE_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });
});

describe('touchShareLinkAccess', () => {
  it('lastAccessedAt を更新する', async () => {
    shareLinkStore.push({
      id: 'sl-1',
      projectId: 'p-1',
      scopeType: 'project',
      scopeTargetId: null,
      tokenHash: 'h',
      issuedByMemberId: 'm-1',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
    });
    await touchShareLinkAccess('sl-1');
    expect(shareLinkStore[0]?.lastAccessedAt).toBeInstanceOf(Date);
    expect(shareLinkUpdate).toHaveBeenCalledWith({
      where: { id: 'sl-1' },
      data: { lastAccessedAt: expect.any(Date) },
    });
  });
});
