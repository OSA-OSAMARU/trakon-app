import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __setMailerForTest } from '../lib/mailer.js';

// =============================================================================
// Mocks (invitations.test.ts と同じ流儀: インメモリストア + vi.mock('@trakon/db'))
//
// 実 DB を通した経路は projectInvitations.integration.test.ts が見る。
// ここでは DB を差し替えて、招待作成の分岐そのものを固定する。
// =============================================================================

type MockProject = { id: string; name: string; deletedAt: Date | null };
type MockMember = {
  id: string;
  projectId: string;
  userId: string | null;
  name: string;
  email: string | null;
  roleType: string;
  sortOrder: number;
  deletedAt: Date | null;
};
type MockInvitation = {
  id: string;
  projectId: string;
  organizationId: string;
  invitedMemberId: string;
  invitedByUserId: string | null;
  email: string;
  roleType: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};
type MockAudit = { action: string; resourceId: string | null; extra: unknown };

const projectStore: Record<string, MockProject> = {};
const memberStore: Record<string, MockMember> = {};
const invitationStore: Record<string, MockInvitation> = {};
const auditStore: MockAudit[] = [];
let seq = 0;
const newId = (p: string) => `${p}-${++seq}`;

const memberTx = {
  findFirst: vi.fn(
    async ({
      where,
      orderBy,
    }: {
      where: {
        id?: string;
        projectId: string;
        email?: string;
        deletedAt: null;
        id_not?: { not: string };
      } & Record<string, unknown>;
      orderBy?: { sortOrder: 'desc' };
    }) => {
      const excluded = (where.id as { not?: string } | string | undefined) ?? undefined;
      const excludeId = typeof excluded === 'object' ? excluded.not : undefined;
      const targetId = typeof excluded === 'string' ? excluded : undefined;

      let rows = Object.values(memberStore).filter(
        (m) => m.projectId === where.projectId && m.deletedAt === null,
      );
      if (targetId) rows = rows.filter((m) => m.id === targetId);
      if (excludeId) rows = rows.filter((m) => m.id !== excludeId);
      if (where.email !== undefined) rows = rows.filter((m) => m.email === where.email);
      if (orderBy?.sortOrder === 'desc') rows = [...rows].sort((a, b) => b.sortOrder - a.sortOrder);
      return rows[0] ?? null;
    },
  ),
  update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MockMember> }) => {
    const row = memberStore[where.id]!;
    Object.assign(row, data);
    return row;
  }),
  create: vi.fn(async ({ data }: { data: Omit<MockMember, 'id' | 'deletedAt'> }) => {
    const row: MockMember = { id: newId('m'), deletedAt: null, ...data };
    memberStore[row.id] = row;
    return row;
  }),
};

const invitationTx = {
  create: vi.fn(
    async ({
      data,
    }: {
      data: Omit<MockInvitation, 'id' | 'createdAt' | 'acceptedAt' | 'revokedAt'>;
    }) => {
      const row: MockInvitation = {
        id: newId('inv'),
        createdAt: new Date('2026-09-01T00:00:00Z'),
        acceptedAt: null,
        revokedAt: null,
        ...data,
      };
      invitationStore[row.id] = row;
      return { ...row, invitedMember: { name: memberStore[row.invitedMemberId]!.name } };
    },
  ),
};

const auditTx = {
  create: vi.fn(async ({ data }: { data: MockAudit }) => {
    auditStore.push(data);
    return data;
  }),
};

const prismaMock = {
  project: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; deletedAt: null } }) => {
      const p = projectStore[where.id];
      return p && p.deletedAt === null ? p : null;
    }),
  },
  user: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id === 'u-inviter' ? { displayName: '招待 する子' } : null,
    ),
  },
  invitation: {
    findMany: vi.fn(async ({ where }: { where: { projectId: string; expiresAt: { gt: Date } } }) =>
      Object.values(invitationStore)
        .filter(
          (i) =>
            i.projectId === where.projectId &&
            i.acceptedAt === null &&
            i.revokedAt === null &&
            i.expiresAt.getTime() > where.expiresAt.gt.getTime(),
        )
        .map((i) => ({ ...i, invitedMember: { name: memberStore[i.invitedMemberId]!.name } })),
    ),
    findFirst: vi.fn(async ({ where }: { where: { id: string; projectId: string } }) => {
      const i = invitationStore[where.id];
      return i && i.projectId === where.projectId && !i.acceptedAt && !i.revokedAt ? i : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { revokedAt: Date } }) => {
      const row = invitationStore[where.id]!;
      Object.assign(row, data);
      return row;
    }),
  },
  auditLog: { create: auditTx.create },
  $transaction: vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => Promise<unknown>)({
      projectMember: memberTx,
      invitation: invitationTx,
      auditLog: auditTx,
    });
  }),
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

const { createInvitation, listPendingInvitations, revokeInvitation } = await import(
  './projectInvitations.js'
);

// =============================================================================
// Fixtures
// =============================================================================

const sendInvitation = vi.fn();

function seedProject(): MockProject {
  const project: MockProject = { id: 'p-1', name: 'プロジェクトA', deletedAt: null };
  projectStore[project.id] = project;
  return project;
}

function seedMember(over: Partial<MockMember> = {}): MockMember {
  const row: MockMember = {
    id: newId('m'),
    projectId: 'p-1',
    userId: null,
    name: '既存 太郎',
    email: null,
    roleType: 'editor',
    sortOrder: 0,
    deletedAt: null,
    ...over,
  };
  memberStore[row.id] = row;
  return row;
}

function input(over: Partial<Parameters<typeof createInvitation>[0]['body']> = {}) {
  return {
    projectId: 'p-1',
    organizationId: 'org-1',
    actorUserId: 'u-inviter',
    origin: 'https://trakon.test',
    body: { email: 'Invitee@Example.test', roleType: 'editor' as const, ...over },
  };
}

beforeEach(() => {
  for (const store of [projectStore, memberStore, invitationStore]) {
    for (const k of Object.keys(store)) delete (store as Record<string, unknown>)[k];
  }
  auditStore.length = 0;
  seq = 0;
  sendInvitation.mockReset().mockResolvedValue(undefined);
  __setMailerForTest({ sendInvitation });
});

afterEach(() => vi.clearAllMocks());

// =============================================================================
// Tests
// =============================================================================

describe('createInvitation', () => {
  describe('正常系', () => {
    it('担当者行を新規に作り、招待とメールを送る', async () => {
      seedProject();

      const { invitation, warnings } = await createInvitation(input());

      // メールアドレスは正規化して保存する
      expect(invitation.email).toBe('invitee@example.test');
      expect(invitation.roleType).toBe('editor');
      expect(warnings).toBeUndefined();

      // 受諾前でも一覧にロールを出せるよう、参加者行にロールを先置きする
      const member = memberStore[invitation.memberId]!;
      expect(member.roleType).toBe('editor');
      expect(member.userId).toBeNull();
      // 表示名の指定が無ければメールアドレスを使う
      expect(member.name).toBe('invitee@example.test');

      expect(sendInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'invitee@example.test',
          projectName: 'プロジェクトA',
          inviterName: '招待 する子',
          acceptUrl: expect.stringMatching(/^https:\/\/trakon\.test\/invitations\/.+/),
        }),
      );
      expect(auditStore.map((a) => a.action)).toEqual(['invitation_created']);
    });

    it('受諾用 URL には生トークンを載せ、DB にはハッシュだけを保存する', async () => {
      seedProject();

      const { invitation } = await createInvitation(input());

      const raw = sendInvitation.mock.calls[0]![0].acceptUrl.split('/').pop() as string;
      const stored = invitationStore[invitation.id]!;
      expect(raw.length).toBeGreaterThan(0);
      expect(stored.tokenHash).not.toBe(raw);
      expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('並び順は既存の担当者の次にする', async () => {
      seedProject();
      seedMember({ sortOrder: 4, email: 'other@example.test' });

      const { invitation } = await createInvitation(input());

      expect(memberStore[invitation.memberId]!.sortOrder).toBe(5);
    });

    it('メール未登録の既存担当者行にメールを付けて招待できる', async () => {
      seedProject();
      const existing = seedMember({ name: '未登録 花子' });

      const { invitation } = await createInvitation(input({ memberId: existing.id }));

      expect(invitation.memberId).toBe(existing.id);
      expect(invitation.memberName).toBe('未登録 花子');
      expect(existing.email).toBe('invitee@example.test');
      expect(memberTx.create).not.toHaveBeenCalled();
    });

    it('メール送信に失敗しても招待は残し、警告として返す', async () => {
      seedProject();
      sendInvitation.mockRejectedValue(new Error('resend unavailable'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { invitation, warnings } = await createInvitation(input());

      // 巻き戻すと「送れなかったのに座席だけ埋まる」より悪い状態 (再送手段が無い) になる
      expect(invitationStore[invitation.id]).toBeDefined();
      expect(warnings).toEqual(['招待は作成しましたが、メールの送信に失敗しました。']);
      consoleError.mockRestore();
    });
  });

  describe('異常系', () => {
    it('プロジェクトが無ければ 404', async () => {
      await expect(createInvitation(input())).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('同じメールの担当者が既にいれば 409 MEMBER_EMAIL_TAKEN', async () => {
      seedProject();
      seedMember({ email: 'invitee@example.test' });

      await expect(createInvitation(input())).rejects.toMatchObject({
        code: 'MEMBER_EMAIL_TAKEN',
        status: 409,
      });
    });

    it('既に参加済みの担当者行は 409 ALREADY_MEMBER', async () => {
      seedProject();
      const joined = seedMember({ userId: 'u-2', email: 'joined@example.test' });

      await expect(createInvitation(input({ memberId: joined.id }))).rejects.toMatchObject({
        code: 'ALREADY_MEMBER',
        status: 409,
      });
    });

    it('指定した担当者行が無ければ 404', async () => {
      seedProject();

      await expect(createInvitation(input({ memberId: 'missing' }))).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('別の担当者が同じメールを持っていれば付け替えを拒否する', async () => {
      seedProject();
      const target = seedMember({ name: '未登録 花子' });
      seedMember({ email: 'invitee@example.test', name: '先客' });

      await expect(createInvitation(input({ memberId: target.id }))).rejects.toMatchObject({
        code: 'MEMBER_EMAIL_TAKEN',
      });
    });
  });
});

describe('listPendingInvitations', () => {
  it('未受諾かつ有効期限内の招待だけを返す (= 座席を消費している招待)', async () => {
    seedProject();
    const { invitation } = await createInvitation(input());
    await createInvitation(input({ email: 'second@example.test' }));
    invitationStore[invitation.id]!.revokedAt = new Date();

    const rows = await listPendingInvitations('p-1');

    expect(rows.map((r) => r.email)).toEqual(['second@example.test']);
  });
});

describe('revokeInvitation', () => {
  it('取り消すと一覧から消え、監査ログが残る', async () => {
    seedProject();
    const { invitation } = await createInvitation(input());
    auditStore.length = 0;

    await revokeInvitation({
      projectId: 'p-1',
      invitationId: invitation.id,
      actorUserId: 'u-inviter',
    });

    expect(invitationStore[invitation.id]!.revokedAt).toBeInstanceOf(Date);
    expect(await listPendingInvitations('p-1')).toEqual([]);
    expect(auditStore.map((a) => a.action)).toEqual(['invitation_revoked']);
  });

  it('存在しない招待は 404', async () => {
    await expect(
      revokeInvitation({ projectId: 'p-1', invitationId: 'missing', actorUserId: 'u-inviter' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
