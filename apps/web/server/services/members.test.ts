import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  listMembers as ListMembersType,
  addMembers as AddMembersType,
  updateMember as UpdateMemberType,
  deleteMember as DeleteMemberType,
} from './members.js';

// =============================================================================
// Mocks
// =============================================================================

type MockMember = {
  id: string;
  projectId: string;
  userId: string | null;
  name: string;
  email: string | null;
  organizationName: string;
  memberType: string;
  jobTitle: string | null;
  roleType: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type MockOrgMember = {
  organizationId: string;
  userId: string;
  defaultProjectRole: string;
  deletedAt: Date | null;
  user: { id: string; displayName: string; email: string; deletedAt: Date | null };
};

// メンバーストア (id -> 行)。各テストで afterEach に全消去する。
const memberStore: Record<string, MockMember> = {};
const orgMemberStore: Record<string, MockOrgMember> = {};

let nextId = 1;
const newId = (prefix: string) => `${prefix}-${nextId++}`;

// projectMember.create の tx 実装 (配列/コールバック両 tx で共有)
const memberCreate = vi.fn(
  async ({ data }: { data: Partial<MockMember> }) => {
    const now = new Date('2026-06-21T00:00:00Z');
    const m: MockMember = {
      id: newId('m'),
      projectId: data.projectId ?? 'p-1',
      userId: data.userId ?? null,
      name: data.name ?? '',
      email: data.email ?? null,
      organizationName: data.organizationName ?? '',
      memberType: data.memberType ?? 'client',
      jobTitle: data.jobTitle ?? null,
      roleType: data.roleType ?? 'editor',
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    memberStore[m.id] = m;
    return m;
  },
);

const prismaMock = {
  projectMember: {
    // listMembers / addMembers の重複チェック両用。
    findMany: vi.fn(
      async (args: {
        where: { projectId: string; deletedAt: null };
        select?: { email?: true; userId?: true };
      }) => {
        const rows = Object.values(memberStore)
          .filter((m) => m.projectId === args.where.projectId && m.deletedAt === null)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
        if (args.select?.email || args.select?.userId) {
          return rows.map((m) => ({
            ...(args.select?.email ? { email: m.email } : {}),
            ...(args.select?.userId ? { userId: m.userId } : {}),
          }));
        }
        return rows;
      },
    ),
    // addMembers の末尾 sortOrder 取得 / update・delete の存在確認両用。
    findFirst: vi.fn(
      async (args: {
        where: { id?: string; projectId: string; deletedAt: null };
        orderBy?: { sortOrder: 'desc' };
        select?: { sortOrder: true };
      }) => {
        const rows = Object.values(memberStore).filter(
          (m) =>
            m.projectId === args.where.projectId &&
            m.deletedAt === null &&
            (args.where.id === undefined || m.id === args.where.id),
        );
        if (args.orderBy?.sortOrder === 'desc') {
          const top = [...rows].sort((a, b) => b.sortOrder - a.sortOrder)[0];
          return top ? { sortOrder: top.sortOrder } : null;
        }
        return rows[0] ?? null;
      },
    ),
    create: memberCreate,
    update: vi.fn(
      async (args: { where: { id: string }; data: Partial<MockMember> }) => {
        const m = memberStore[args.where.id];
        if (!m) throw new Error('not found in mock');
        for (const [k, v] of Object.entries(args.data)) {
          if (v !== undefined) (m as Record<string, unknown>)[k] = v;
        }
        m.updatedAt = new Date('2026-06-22T00:00:00Z');
        return m;
      },
    ),
    delete: vi.fn(async (args: { where: { id: string } }) => {
      const m = memberStore[args.where.id];
      delete memberStore[args.where.id];
      return m;
    }),
  },
  // 組織メンバー (#202)。参加者はここに居る人からしか選べない。
  organizationMember: {
    findMany: vi.fn(
      async (args: {
        where: { organizationId: string; userId: { in: string[] }; deletedAt: null };
      }) =>
        Object.values(orgMemberStore).filter(
          (om) =>
            om.organizationId === args.where.organizationId &&
            args.where.userId.in.includes(om.userId) &&
            om.deletedAt === null,
        ),
    ),
  },
  // members.ts はコールバック形式 ($transaction(fn)) のみ使用。
  $transaction: vi.fn(async (arg: unknown) => {
    return (arg as (tx: unknown) => Promise<unknown>)({
      projectMember: { create: memberCreate },
    });
  }),
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// =============================================================================
// Tests
// =============================================================================

let listMembers: typeof ListMembersType;
let addMembers: typeof AddMembersType;
let updateMember: typeof UpdateMemberType;
let deleteMember: typeof DeleteMemberType;

beforeAll(async () => {
  ({ listMembers, addMembers, updateMember, deleteMember } = await import('./members.js'));
});

afterEach(() => {
  for (const k of Object.keys(memberStore)) delete memberStore[k];
  for (const k of Object.keys(orgMemberStore)) delete orgMemberStore[k];
  vi.clearAllMocks();
});

const ORG_ID = 'org-1';

/** 組織メンバー (= プロジェクトへ追加できる候補) を 1 人投入する。 */
function seedOrgMember(over: Partial<MockOrgMember> & { userId: string }): MockOrgMember {
  const om: MockOrgMember = {
    organizationId: over.organizationId ?? ORG_ID,
    userId: over.userId,
    defaultProjectRole: over.defaultProjectRole ?? 'editor',
    deletedAt: over.deletedAt ?? null,
    user: over.user ?? {
      id: over.userId,
      displayName: `User ${over.userId}`,
      email: `${over.userId}@x.test`,
      deletedAt: null,
    },
  };
  orgMemberStore[om.userId] = om;
  return om;
}

// 既存メンバーをストアへ投入するヘルパ
function seedMember(over: Partial<MockMember> = {}): MockMember {
  const now = new Date('2026-01-01T00:00:00Z');
  const m: MockMember = {
    id: over.id ?? newId('seed'),
    projectId: over.projectId ?? 'p-1',
    userId: over.userId ?? null,
    name: over.name ?? 'Seed',
    email: 'email' in over ? (over.email ?? null) : 'seed@example.com',
    organizationName: over.organizationName ?? 'Org',
    memberType: over.memberType ?? 'client',
    jobTitle: over.jobTitle ?? null,
    roleType: over.roleType ?? 'editor',
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? now,
    updatedAt: over.updatedAt ?? now,
    deletedAt: over.deletedAt ?? null,
  };
  memberStore[m.id] = m;
  return m;
}

describe('listMembers', () => {
  it('returns members sorted by sortOrder and maps DTO fields', async () => {
    seedMember({ id: 'm-b', name: 'B', email: 'b@x.test', sortOrder: 1, userId: 'u-1' });
    seedMember({ id: 'm-a', name: 'A', email: 'a@x.test', sortOrder: 0, memberType: 'production' });
    const res = await listMembers('p-1');
    expect(res.map((m) => m.id)).toEqual(['m-a', 'm-b']);
    expect(res[0]).toMatchObject({
      id: 'm-a',
      name: 'A',
      email: 'a@x.test',
      memberType: 'production',
      sortOrder: 0,
    });
    // createdAt/updatedAt は ISO 文字列化される
    expect(typeof res[0]!.createdAt).toBe('string');
    expect(res[0]!.createdAt).toBe(new Date('2026-01-01T00:00:00Z').toISOString());
  });

  it('returns null email for members without a registered email', async () => {
    seedMember({ id: 'm-noemail', name: 'NoEmail', email: null });
    const [m] = await listMembers('p-1');
    expect(m!.email).toBeNull();
  });

  it('returns empty array when project has no members', async () => {
    const res = await listMembers('p-empty');
    expect(res).toEqual([]);
  });
});

describe('addMembers', () => {
  it('組織メンバーをアカウント紐付き参加者として追加し、sortOrder を末尾から採番する', async () => {
    // 既存メンバー sortOrder=2 → 新規は 3, 4 と採番される
    seedMember({ id: 'm-old', email: 'old@x.test', sortOrder: 2 });
    seedOrgMember({ userId: 'u-1' });
    seedOrgMember({ userId: 'u-2' });

    const res = await addMembers({
      projectId: 'p-1',
      organizationId: ORG_ID,
      body: {
        members: [
          { userId: 'u-1', memberType: 'client', roleType: 'editor' },
          { userId: 'u-2', memberType: 'production', roleType: 'editor' },
        ],
      },
    });

    expect(res).toHaveLength(2);
    expect(res.map((m) => m.sortOrder)).toEqual([3, 4]);
    // 氏名・メールは入力ではなくアカウントから引く (#156)
    expect(res[0]).toMatchObject({
      name: 'User u-1',
      email: 'u-1@x.test',
      memberType: 'client',
      userId: 'u-1',
    });
  });

  it('権限を省略すると組織で設定された既定ロールを使う', async () => {
    seedOrgMember({ userId: 'u-v', defaultProjectRole: 'viewer' });
    const res = await addMembers({
      projectId: 'p-1',
      organizationId: ORG_ID,
      body: { members: [{ userId: 'u-v', memberType: 'production' }] },
    });
    expect(res[0]!.roleType).toBe('viewer');
  });

  it('所属・職種は参加者行に持たせない (users 側が正)', async () => {
    seedOrgMember({ userId: 'u-1' });
    const res = await addMembers({
      projectId: 'p-1',
      organizationId: ORG_ID,
      body: { members: [{ userId: 'u-1', memberType: 'production' }] },
    });
    expect(res[0]).toMatchObject({ organizationName: '', jobTitle: null });
  });

  it('プロジェクトが空なら sortOrder は 0 から始まる', async () => {
    seedOrgMember({ userId: 'u-1' });
    const res = await addMembers({
      projectId: 'p-1',
      organizationId: ORG_ID,
      body: { members: [{ userId: 'u-1', memberType: 'client' }] },
    });
    expect(res[0]!.sortOrder).toBe(0);
  });

  it('組織メンバーでない相手は 422 NOT_ORGANIZATION_MEMBER', async () => {
    // 組織外の人はまず「メンバー管理」から組織へ招待してもらう一本道にしている (#202)
    await expect(
      addMembers({
        projectId: 'p-1',
        organizationId: ORG_ID,
        body: { members: [{ userId: 'u-outsider', memberType: 'client' }] },
      }),
    ).rejects.toMatchObject({ code: 'NOT_ORGANIZATION_MEMBER', status: 422 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('別組織のメンバーも追加できない', async () => {
    seedOrgMember({ userId: 'u-other', organizationId: 'org-2' });
    await expect(
      addMembers({
        projectId: 'p-1',
        organizationId: ORG_ID,
        body: { members: [{ userId: 'u-other', memberType: 'client' }] },
      }),
    ).rejects.toMatchObject({ code: 'NOT_ORGANIZATION_MEMBER', status: 422 });
  });

  it('退会済みのアカウントは追加できない', async () => {
    seedOrgMember({
      userId: 'u-gone',
      user: {
        id: 'u-gone',
        displayName: 'Gone',
        email: 'gone@x.test',
        deletedAt: new Date('2026-05-01T00:00:00Z'),
      },
    });
    await expect(
      addMembers({
        projectId: 'p-1',
        organizationId: ORG_ID,
        body: { members: [{ userId: 'u-gone', memberType: 'client' }] },
      }),
    ).rejects.toMatchObject({ code: 'NOT_ORGANIZATION_MEMBER', status: 422 });
  });

  it('既に参加している相手は 409 ALREADY_MEMBER', async () => {
    seedMember({ id: 'm-dup', userId: 'u-1', email: 'u-1@x.test' });
    seedOrgMember({ userId: 'u-1' });
    await expect(
      addMembers({
        projectId: 'p-1',
        organizationId: ORG_ID,
        body: { members: [{ userId: 'u-1', memberType: 'client' }] },
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_MEMBER', status: 409 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('アカウント紐付け前の参加者行がメールで残っていれば 409 MEMBER_EMAIL_TAKEN', async () => {
    seedMember({ id: 'm-legacy', userId: null, email: 'u-1@x.test' });
    seedOrgMember({ userId: 'u-1' });
    await expect(
      addMembers({
        projectId: 'p-1',
        organizationId: ORG_ID,
        body: { members: [{ userId: 'u-1', memberType: 'client' }] },
      }),
    ).rejects.toMatchObject({
      code: 'MEMBER_EMAIL_TAKEN',
      status: 409,
      details: { email: 'u-1@x.test' },
    });
  });

  it('同じ相手を 1 回のリクエストで重複指定すると 422', async () => {
    seedOrgMember({ userId: 'u-1' });
    await expect(
      addMembers({
        projectId: 'p-1',
        organizationId: ORG_ID,
        body: {
          members: [
            { userId: 'u-1', memberType: 'client' },
            { userId: 'u-1', memberType: 'production' },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_MEMBER', status: 422 });
  });
});

describe('updateMember', () => {
  it('updates provided fields and returns the DTO', async () => {
    seedMember({ id: 'm-up', projectId: 'p-1', name: 'Old', sortOrder: 5, memberType: 'client' });
    const res = await updateMember({
      memberId: 'm-up',
      projectId: 'p-1',
      body: { name: 'New Name', sortOrder: 9, memberType: 'production', roleType: 'editor' },
    });
    expect(res).toMatchObject({ id: 'm-up', name: 'New Name', sortOrder: 9, memberType: 'production' });
    expect(memberStore['m-up']!.name).toBe('New Name');
    expect(memberStore['m-up']!.sortOrder).toBe(9);
  });

  it('leaves fields unchanged when body is empty (all undefined)', async () => {
    seedMember({ id: 'm-noop', projectId: 'p-1', name: 'Keep', organizationName: 'KeepOrg' });
    const res = await updateMember({ memberId: 'm-noop', projectId: 'p-1', body: {} });
    expect(res.name).toBe('Keep');
    expect(res.organizationName).toBe('KeepOrg');
  });

  it('throws 404 NOT_FOUND when the member does not exist in the project', async () => {
    await expect(
      updateMember({ memberId: 'missing', projectId: 'p-1', body: { name: 'X' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(prismaMock.projectMember.update).not.toHaveBeenCalled();
  });
});

describe('deleteMember', () => {
  it('hard-deletes a member who is not the current user', async () => {
    seedMember({ id: 'm-del', projectId: 'p-1', userId: 'u-other' });
    await expect(
      deleteMember({ memberId: 'm-del', projectId: 'p-1', currentUserId: 'u-self' }),
    ).resolves.toBeUndefined();
    expect(prismaMock.projectMember.delete).toHaveBeenCalledWith({ where: { id: 'm-del' } });
    expect(memberStore['m-del']).toBeUndefined();
  });

  it('deletes a pending (userId=null) member', async () => {
    seedMember({ id: 'm-pend-del', projectId: 'p-1', userId: null });
    await deleteMember({ memberId: 'm-pend-del', projectId: 'p-1', currentUserId: 'u-self' });
    expect(memberStore['m-pend-del']).toBeUndefined();
  });

  it('throws 404 NOT_FOUND when the member does not exist', async () => {
    await expect(
      deleteMember({ memberId: 'missing', projectId: 'p-1', currentUserId: 'u-self' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(prismaMock.projectMember.delete).not.toHaveBeenCalled();
  });

  it('throws 409 CANNOT_REMOVE_SELF when removing the director themselves', async () => {
    seedMember({ id: 'm-self', projectId: 'p-1', userId: 'u-self' });
    await expect(
      deleteMember({ memberId: 'm-self', projectId: 'p-1', currentUserId: 'u-self' }),
    ).rejects.toMatchObject({ code: 'CANNOT_REMOVE_SELF', status: 409 });
    expect(prismaMock.projectMember.delete).not.toHaveBeenCalled();
  });
});
