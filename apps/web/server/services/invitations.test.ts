import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { hashToken } from '../lib/tokens.js';

import type {
  verifyInvitation as VerifyInvitationType,
  acceptInvitation as AcceptInvitationType,
} from './invitations.js';

// =============================================================================
// Mocks (auth.test.ts のパターン: インメモリストア + vi.mock('@trakon/db') + 動的 import)
// =============================================================================

type MockMember = {
  id: string;
  projectId: string;
  userId: string | null;
  name: string;
  email: string;
  organizationName: string;
  memberType: string;
  deletedAt: Date | null;
};
type MockProject = { id: string; name: string };
type MockInvitation = {
  id: string;
  tokenHash: string;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  projectId: string;
  invitedMemberId: string;
};
type MockUser = { id: string; email: string };
type MockAudit = {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  extra: unknown;
};

const projectStore: Record<string, MockProject> = {};
const memberStore: Record<string, MockMember> = {};
const invitationStore: Record<string, MockInvitation> = {};
const userStore: Record<string, MockUser> = {};
const auditStore: MockAudit[] = [];

let nextId = 1;
const newId = (prefix: string) => `${prefix}-${nextId++}`;

// invitations.ts の findActiveInvitation が要求する where 条件を再現する。
// (tokenHash 一致 / acceptedAt = null / revokedAt = null / expiresAt > now)
const matchActive = (inv: MockInvitation, tokenHash: string, now: Date): boolean =>
  inv.tokenHash === tokenHash &&
  inv.acceptedAt === null &&
  inv.revokedAt === null &&
  inv.expiresAt.getTime() > now.getTime();

// include で展開された invitation を返すヘルパ。
const withIncludes = (inv: MockInvitation) => {
  const project = projectStore[inv.projectId]!;
  const member = memberStore[inv.invitedMemberId]!;
  return {
    ...inv,
    project: { id: project.id, name: project.name },
    invitedMember: {
      id: member.id,
      name: member.name,
      email: member.email,
      organizationName: member.organizationName,
      memberType: member.memberType,
    },
  };
};

const invitationTx = {
  update: vi.fn(
    async ({ where, data }: { where: { id: string }; data: { acceptedAt: Date } }) => {
      const inv = invitationStore[where.id]!;
      inv.acceptedAt = data.acceptedAt;
      return inv;
    },
  ),
};
const memberTx = {
  update: vi.fn(
    async ({ where, data }: { where: { id: string }; data: { userId: string } }) => {
      const m = memberStore[where.id]!;
      m.userId = data.userId;
      return m;
    },
  ),
};
const auditTx = {
  create: vi.fn(async ({ data }: { data: Omit<MockAudit, 'id'> }) => {
    const r: MockAudit = { id: newId('a'), ...data };
    auditStore.push(r);
    return r;
  }),
};

const prismaMock = {
  invitation: {
    findFirst: vi.fn(
      async ({ where }: { where: { tokenHash: string; expiresAt: { gt: Date } } }) => {
        const now = where.expiresAt.gt;
        const inv = Object.values(invitationStore).find((i) =>
          matchActive(i, where.tokenHash, now),
        );
        return inv ? withIncludes(inv) : null;
      },
    ),
  },
  user: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return userStore[where.id] ?? null;
    }),
  },
  projectMember: {
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: {
          projectId: string;
          userId: string;
          id: { not: string };
          deletedAt: null;
        };
      }) => {
        return (
          Object.values(memberStore).find(
            (m) =>
              m.projectId === where.projectId &&
              m.userId === where.userId &&
              m.id !== where.id.not &&
              m.deletedAt === null,
          ) ?? null
        );
      },
    ),
  },
  // コールバック形式 ($transaction(fn)) を再現。
  $transaction: vi.fn(async (arg: unknown) => {
    return (arg as (tx: unknown) => Promise<unknown>)({
      invitation: invitationTx,
      projectMember: memberTx,
      auditLog: auditTx,
    });
  }),
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// =============================================================================
// Fixtures
// =============================================================================

const RAW_TOKEN = 'raw-token-abc123';
const TOKEN_HASH = hashToken(RAW_TOKEN);

// 有効な招待 (project / member / invitation) を1セット用意する。
function seedValidInvitation(
  overrides: {
    inv?: Partial<MockInvitation>;
    member?: Partial<MockMember>;
    project?: Partial<MockProject>;
  } = {},
) {
  const project: MockProject = { id: 'p-1', name: 'プロジェクトA', ...overrides.project };
  const member: MockMember = {
    id: 'm-1',
    projectId: project.id,
    userId: null,
    name: '招待 太郎',
    email: 'invitee@example.com',
    organizationName: '組織X',
    memberType: 'client',
    deletedAt: null,
    ...overrides.member,
  };
  const inv: MockInvitation = {
    id: 'inv-1',
    tokenHash: TOKEN_HASH,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date('2999-01-01T00:00:00Z'),
    projectId: project.id,
    invitedMemberId: member.id,
    ...overrides.inv,
  };
  projectStore[project.id] = project;
  memberStore[member.id] = member;
  invitationStore[inv.id] = inv;
  return { project, member, inv };
}

// =============================================================================
// Tests
// =============================================================================

let verifyInvitation: typeof VerifyInvitationType;
let acceptInvitation: typeof AcceptInvitationType;

beforeAll(async () => {
  ({ verifyInvitation, acceptInvitation } = await import('./invitations.js'));
});

afterEach(() => {
  for (const k of Object.keys(projectStore)) delete projectStore[k];
  for (const k of Object.keys(memberStore)) delete memberStore[k];
  for (const k of Object.keys(invitationStore)) delete invitationStore[k];
  for (const k of Object.keys(userStore)) delete userStore[k];
  auditStore.length = 0;
  vi.clearAllMocks();
});

describe('verifyInvitation', () => {
  it('有効な招待を検証して DTO を返す', async () => {
    seedValidInvitation();
    const res = await verifyInvitation(RAW_TOKEN);
    expect(res).toMatchObject({
      project: { id: 'p-1', name: 'プロジェクトA' },
      invitedMember: {
        id: 'm-1',
        name: '招待 太郎',
        email: 'invitee@example.com',
        organizationName: '組織X',
        memberType: 'client',
      },
    });
    expect(res.expiresAt).toBe(new Date('2999-01-01T00:00:00Z').toISOString());
  });

  it('期限切れの招待は 404 INVITATION_NOT_FOUND_OR_EXPIRED', async () => {
    seedValidInvitation({ inv: { expiresAt: new Date('2000-01-01T00:00:00Z') } });
    await expect(verifyInvitation(RAW_TOKEN)).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });

  it('受諾済の招待は 404', async () => {
    seedValidInvitation({ inv: { acceptedAt: new Date('2026-01-01T00:00:00Z') } });
    await expect(verifyInvitation(RAW_TOKEN)).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });

  it('失効済 (revoked) の招待は 404', async () => {
    seedValidInvitation({ inv: { revokedAt: new Date('2026-01-01T00:00:00Z') } });
    await expect(verifyInvitation(RAW_TOKEN)).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });

  it('トークンが一致しない (未存在) 場合は 404', async () => {
    seedValidInvitation();
    await expect(verifyInvitation('wrong-token')).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
  });
});

describe('acceptInvitation', () => {
  it('成功: member.user_id 紐付け / invitation.accepted_at 設定 / audit ログ作成', async () => {
    const { inv, member, project } = seedValidInvitation();
    userStore['u-1'] = { id: 'u-1', email: 'invitee@example.com' };

    const res = await acceptInvitation({ rawToken: RAW_TOKEN, currentUserId: 'u-1' });

    expect(res).toEqual({
      project: { id: project.id, name: project.name },
      member: { id: member.id, memberType: 'client' },
    });
    // member に user_id が紐付く
    expect(memberStore[member.id]!.userId).toBe('u-1');
    // invitation が受諾済になる
    expect(invitationStore[inv.id]!.acceptedAt).toBeInstanceOf(Date);
    // audit ログ
    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]).toMatchObject({
      actorUserId: 'u-1',
      action: 'login',
      resourceType: 'invitation',
      resourceId: inv.id,
      result: 'success',
      extra: { projectId: project.id, memberId: member.id },
    });
  });

  it('メール大文字小文字を無視して一致判定する', async () => {
    seedValidInvitation({ member: { email: 'Invitee@Example.com' } });
    userStore['u-1'] = { id: 'u-1', email: 'invitee@example.com' };
    const res = await acceptInvitation({ rawToken: RAW_TOKEN, currentUserId: 'u-1' });
    expect(res.member.memberType).toBe('client');
  });

  it('招待が無効 (期限切れ等) なら 404', async () => {
    seedValidInvitation({ inv: { revokedAt: new Date('2026-01-01T00:00:00Z') } });
    userStore['u-1'] = { id: 'u-1', email: 'invitee@example.com' };
    await expect(
      acceptInvitation({ rawToken: RAW_TOKEN, currentUserId: 'u-1' }),
    ).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND_OR_EXPIRED', status: 404 });
  });

  it('ユーザープロフィール未完了は 404 PROFILE_NOT_COMPLETED', async () => {
    seedValidInvitation();
    // userStore に該当ユーザーなし
    await expect(
      acceptInvitation({ rawToken: RAW_TOKEN, currentUserId: 'u-missing' }),
    ).rejects.toMatchObject({ code: 'PROFILE_NOT_COMPLETED', status: 404 });
  });

  it('招待先メールと一致しないと 403 INVITATION_EMAIL_MISMATCH', async () => {
    seedValidInvitation();
    userStore['u-1'] = { id: 'u-1', email: 'other@example.com' };
    await expect(
      acceptInvitation({ rawToken: RAW_TOKEN, currentUserId: 'u-1' }),
    ).rejects.toMatchObject({ code: 'INVITATION_EMAIL_MISMATCH', status: 403 });
  });

  it('既に別 member 行で参加済なら 409 ALREADY_MEMBER', async () => {
    const { project } = seedValidInvitation();
    userStore['u-1'] = { id: 'u-1', email: 'invitee@example.com' };
    // 同一プロジェクトに別 member 行 (招待対象 m-1 とは別 id) で既に参加
    memberStore['m-dup'] = {
      id: 'm-dup',
      projectId: project.id,
      userId: 'u-1',
      name: '既存',
      email: 'invitee@example.com',
      organizationName: '組織X',
      memberType: 'production',
      deletedAt: null,
    };
    await expect(
      acceptInvitation({ rawToken: RAW_TOKEN, currentUserId: 'u-1' }),
    ).rejects.toMatchObject({ code: 'ALREADY_MEMBER', status: 409 });
    // トランザクションは実行されない
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
