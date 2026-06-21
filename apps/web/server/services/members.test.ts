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

type MockInvitation = {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};
type MockMember = {
  id: string;
  projectId: string;
  userId: string | null;
  name: string;
  email: string;
  organizationName: string;
  memberType: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  invitations: MockInvitation[];
};

// メンバーストア (id -> 行)。各テストで afterEach に全消去する。
const memberStore: Record<string, MockMember> = {};
// invitation.create 呼び出しを記録 (tx 内 INSERT の検証用)
const invitationStore: Array<Record<string, unknown>> = [];

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
      email: data.email ?? '',
      organizationName: data.organizationName ?? '',
      memberType: data.memberType ?? 'client',
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      invitations: [],
    };
    memberStore[m.id] = m;
    return m;
  },
);

const invitationCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
  invitationStore.push(data);
  return { id: newId('inv'), ...data };
});

const prismaMock = {
  projectMember: {
    // listMembers / addMembers の重複チェック両用。
    findMany: vi.fn(
      async (args: {
        where: { projectId: string; deletedAt: null };
        select?: { email: true };
        include?: unknown;
      }) => {
        const rows = Object.values(memberStore)
          .filter((m) => m.projectId === args.where.projectId && m.deletedAt === null)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
        if (args.select?.email) {
          return rows.map((m) => ({ email: m.email }));
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
      async (args: { where: { id: string }; data: Partial<MockMember>; include?: unknown }) => {
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
  invitation: { create: invitationCreate },
  // members.ts はコールバック形式 ($transaction(fn)) のみ使用。
  $transaction: vi.fn(async (arg: unknown) => {
    return (arg as (tx: unknown) => Promise<unknown>)({
      projectMember: { create: memberCreate },
      invitation: { create: invitationCreate },
    });
  }),
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// env: PUBLIC_APP_URL のみ参照される。
vi.mock('../lib/env.js', () => ({
  getServerEnv: () => ({ PUBLIC_APP_URL: 'https://app.example.test' }),
}));

// mailer: sendInvitation のモック。失敗系テストで一時的に reject させる。
const sendInvitationMock = vi.fn(async () => undefined);
vi.mock('../lib/mailer.js', () => ({
  getMailer: () => ({ sendInvitation: sendInvitationMock }),
}));

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
  invitationStore.length = 0;
  vi.clearAllMocks();
  // clearAllMocks は実装を消さないため再設定は不要だが、reject 設定はリセットしておく。
  sendInvitationMock.mockImplementation(async () => undefined);
});

// 既存メンバーをストアへ投入するヘルパ
function seedMember(over: Partial<MockMember> = {}): MockMember {
  const now = new Date('2026-01-01T00:00:00Z');
  const m: MockMember = {
    id: over.id ?? newId('seed'),
    projectId: over.projectId ?? 'p-1',
    userId: over.userId ?? null,
    name: over.name ?? 'Seed',
    email: over.email ?? 'seed@example.com',
    organizationName: over.organizationName ?? 'Org',
    memberType: over.memberType ?? 'client',
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? now,
    updatedAt: over.updatedAt ?? now,
    deletedAt: over.deletedAt ?? null,
    invitations: over.invitations ?? [],
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

  it('inviteStatus = accepted when userId is set', async () => {
    seedMember({ id: 'm-acc', userId: 'u-9' });
    const [m] = await listMembers('p-1');
    expect(m!.inviteStatus).toBe('accepted');
  });

  it('inviteStatus = pending when an active invitation exists', async () => {
    seedMember({
      id: 'm-pend',
      userId: null,
      invitations: [
        { acceptedAt: null, revokedAt: null, expiresAt: new Date('2999-01-01T00:00:00Z') },
      ],
    });
    const [m] = await listMembers('p-1');
    expect(m!.inviteStatus).toBe('pending');
  });

  it('inviteStatus = expired when invitation is past expiry / revoked / accepted', async () => {
    seedMember({
      id: 'm-exp',
      userId: null,
      invitations: [
        { acceptedAt: null, revokedAt: null, expiresAt: new Date('2000-01-01T00:00:00Z') },
        { acceptedAt: null, revokedAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date('2999-01-01T00:00:00Z') },
      ],
    });
    const [m] = await listMembers('p-1');
    expect(m!.inviteStatus).toBe('expired');
  });

  it('returns empty array when project has no members', async () => {
    const res = await listMembers('p-empty');
    expect(res).toEqual([]);
  });
});

describe('addMembers', () => {
  const baseInput = {
    projectId: 'p-1',
    projectName: 'My Project',
    inviterDisplayName: 'Director',
  };

  it('creates members + invitations + sends mail, assigning sortOrder from tail', async () => {
    // 既存メンバー sortOrder=2 → 新規は 3, 4 と採番される
    seedMember({ id: 'm-old', email: 'old@x.test', sortOrder: 2 });
    const res = await addMembers({
      ...baseInput,
      body: {
        members: [
          { name: 'New1', email: 'new1@x.test', organizationName: 'O1', memberType: 'client' },
          { name: 'New2', email: 'new2@x.test', organizationName: 'O2', memberType: 'production' },
        ],
      },
    });
    expect(res).toHaveLength(2);
    expect(res.map((m) => m.sortOrder)).toEqual([3, 4]);
    expect(res.map((m) => m.inviteStatus)).toEqual(['pending', 'pending']);
    expect(res[0]).toMatchObject({ name: 'New1', email: 'new1@x.test', memberType: 'client', userId: null });
    // invitation INSERT が 2 件、メール送信が 2 回
    expect(invitationStore).toHaveLength(2);
    expect(sendInvitationMock).toHaveBeenCalledTimes(2);
    // acceptUrl が env の PUBLIC_APP_URL を含む
    const mailArg = (sendInvitationMock.mock.calls[0] as unknown[])[0] as { acceptUrl: string; projectName: string; inviterName: string };
    expect(mailArg.acceptUrl).toMatch(/^https:\/\/app\.example\.test\/invitations\//);
    expect(mailArg.projectName).toBe('My Project');
    expect(mailArg.inviterName).toBe('Director');
  });

  it('assigns sortOrder starting at 0 when project is empty', async () => {
    const res = await addMembers({
      ...baseInput,
      body: {
        members: [{ name: 'First', email: 'first@x.test', organizationName: '', memberType: 'client' }],
      },
    });
    expect(res[0]!.sortOrder).toBe(0);
  });

  it('throws 409 MEMBER_EMAIL_TAKEN when an email already exists in the project', async () => {
    seedMember({ id: 'm-dup', email: 'dup@x.test' });
    await expect(
      addMembers({
        ...baseInput,
        body: {
          members: [{ name: 'Dup', email: 'dup@x.test', organizationName: '', memberType: 'client' }],
        },
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_EMAIL_TAKEN', status: 409, details: { email: 'dup@x.test' } });
    // 重複検知時は tx 自体に入らない
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(sendInvitationMock).not.toHaveBeenCalled();
  });

  it('rolls back (rejects) when mailer fails inside the transaction', async () => {
    sendInvitationMock.mockRejectedValueOnce(new Error('smtp down'));
    await expect(
      addMembers({
        ...baseInput,
        body: {
          members: [{ name: 'X', email: 'x@x.test', organizationName: '', memberType: 'client' }],
        },
      }),
    ).rejects.toThrow('smtp down');
  });
});

describe('updateMember', () => {
  it('updates provided fields and returns the DTO', async () => {
    seedMember({ id: 'm-up', projectId: 'p-1', name: 'Old', sortOrder: 5, memberType: 'client' });
    const res = await updateMember({
      memberId: 'm-up',
      projectId: 'p-1',
      body: { name: 'New Name', sortOrder: 9, memberType: 'production' },
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
