import { beforeEach, describe, expect, it, vi } from 'vitest';

// prisma を差し替える。実 DB を通す経路は orgMembers.integration.test.ts が見る。
// ここでは「一覧の組み立て」「権限伝播の順序と検証」「招待の重複判定」といった
// 分岐だけを固定する。
const prismaMock = {
  organizationMember: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  invitation: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  projectMember: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    groupBy: vi.fn(),
  },
  project: { findFirst: vi.fn() },
  plan: { findMany: vi.fn() },
  organization: { findUniqueOrThrow: vi.fn() },
  user: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => Promise<unknown>)(prismaMock);
  }),
};
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

const getEntitlementMock = vi.fn();
vi.mock('./billing/entitlement.js', () => ({
  getEntitlement: (...a: unknown[]) => getEntitlementMock(...a),
}));

const assertNotLastAdminMock = vi.fn();
vi.mock('./members.js', () => ({
  assertNotLastAdmin: (...a: unknown[]) => assertNotLastAdminMock(...a),
}));

const sendInvitationMock = vi.fn();
vi.mock('../lib/mailer.js', () => ({
  getMailer: () => ({ sendInvitation: sendInvitationMock }),
}));

vi.mock('../lib/avatarStorage.js', () => ({
  signAvatarUrls: async () => new Map([['u1/a.webp', 'https://signed.test/a.webp']]),
}));

const {
  changeDefaultProjectRole,
  createOrgInvitation,
  listMemberProjects,
  listOrgMembers,
  resendOrgInvitation,
  revokeOrgInvitation,
} = await import('./orgMembers.js');

const entitlement = (over: Record<string, unknown> = {}) => ({
  canInviteMember: true,
  canInviteViewer: true,
  limits: { seatLimit: 5, viewerLimit: 20, projectLimit: null },
  usage: { seatCount: 1, viewerCount: 0, projectCount: 0 },
  effectivePlanCode: 'team',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getEntitlementMock.mockResolvedValue(entitlement());
  prismaMock.organizationMember.findMany.mockResolvedValue([]);
  prismaMock.invitation.findMany.mockResolvedValue([]);
  prismaMock.projectMember.findMany.mockResolvedValue([]);
  prismaMock.projectMember.groupBy.mockResolvedValue([]);
  prismaMock.plan.findMany.mockResolvedValue([]);
  sendInvitationMock.mockResolvedValue(undefined);
});

describe('listOrgMembers', () => {
  const member = {
    userId: 'u-1',
    orgRole: 'owner',
    defaultProjectRole: 'admin',
    joinedAt: new Date('2026-01-01T00:00:00Z'),
    user: {
      id: 'u-1',
      fullName: '佐藤 航',
      displayName: '佐藤',
      organizationName: 'おさまるカンパニー',
      jobTitle: 'director',
      notificationEmail: null,
      email: 'sato@example.jp',
      avatarPath: 'u1/a.webp',
    },
  };

  it('会員と保留中の招待を 1 つの一覧にまとめる', async () => {
    prismaMock.organizationMember.findMany.mockResolvedValue([member]);
    prismaMock.invitation.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        email: 'misaki@example.test',
        roleType: 'editor',
        invitedName: '石原 美咲',
        organizationName: null,
        jobTitle: null,
        expiresAt: new Date('2026-02-01T00:00:00Z'),
        invitedMember: null,
      },
    ]);
    prismaMock.projectMember.groupBy.mockResolvedValue([{ userId: 'u-1', _count: { _all: 3 } }]);

    const rows = await listOrgMembers('org-1');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      userId: 'u-1',
      status: 'active',
      // 全画面で表示名に揃える (#254)
      name: '佐藤',
      organizationName: 'おさまるカンパニー',
      // 通知先メール未設定ならログイン用メール (#156)
      email: 'sato@example.jp',
      jobTitle: 'director',
      avatarUrl: 'https://signed.test/a.webp',
      defaultProjectRole: 'admin',
      projectCount: 3,
    });
    expect(rows[1]).toMatchObject({
      userId: null,
      invitationId: 'inv-1',
      status: 'invited',
      name: '石原 美咲',
      // 招待中は本人がまだ何も設定していない
      organizationName: null,
      jobTitle: null,
      projectCount: 0,
    });
  });

  it('参加プロジェクト数は 1 クエリでまとめて数える (人数分ループしない)', async () => {
    prismaMock.organizationMember.findMany.mockResolvedValue([
      member,
      { ...member, userId: 'u-2', user: { ...member.user, id: 'u-2' } },
    ]);

    await listOrgMembers('org-1');

    expect(prismaMock.projectMember.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaMock.projectMember.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['userId'] }),
    );
  });

  it('会員が居なければ参加数のクエリを投げない', async () => {
    await listOrgMembers('org-1');
    expect(prismaMock.projectMember.groupBy).not.toHaveBeenCalled();
  });
});

describe('changeDefaultProjectRole', () => {
  const target = { id: 'om-1', orgRole: 'member', defaultProjectRole: 'editor' };

  it('参加中の全プロジェクトへ反映し、監査ログを残す', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue(target);
    prismaMock.projectMember.findMany.mockResolvedValue([
      { id: 'pm-1', projectId: 'p-1', roleType: 'editor' },
      { id: 'pm-2', projectId: 'p-2', roleType: 'editor' },
    ]);

    const res = await changeDefaultProjectRole({
      organizationId: 'org-1',
      targetUserId: 'u-2',
      defaultProjectRole: 'admin',
      actorUserId: 'u-1',
    });

    expect(res.affectedProjectIds).toEqual(['p-1', 'p-2']);
    expect(prismaMock.projectMember.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pm-1', 'pm-2'] } },
      data: { roleType: 'admin' },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'project_role_changed' }),
      }),
    );
  });

  it('同じロールなら何もしない', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue(target);

    const res = await changeDefaultProjectRole({
      organizationId: 'org-1',
      targetUserId: 'u-2',
      defaultProjectRole: 'editor',
      actorUserId: 'u-1',
    });

    expect(res.affectedProjectIds).toEqual([]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('存在しない会員は 404', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue(null);

    await expect(
      changeDefaultProjectRole({
        organizationId: 'org-1',
        targetUserId: 'u-9',
        defaultProjectRole: 'admin',
        actorUserId: 'u-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('オーナーを管理者以外にはできない', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue({
      id: 'om-0',
      orgRole: 'owner',
      defaultProjectRole: 'admin',
    });

    await expect(
      changeDefaultProjectRole({
        organizationId: 'org-1',
        targetUserId: 'u-1',
        defaultProjectRole: 'editor',
        actorUserId: 'u-1',
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_CHANGE_OWNER', status: 409 });
  });

  it('閲覧者からの昇格は座席の空きを確認する (抜け道を塞ぐ)', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue({
      id: 'om-1',
      orgRole: 'member',
      defaultProjectRole: 'viewer',
    });
    getEntitlementMock.mockResolvedValue(entitlement({ canInviteMember: false }));

    await expect(
      changeDefaultProjectRole({
        organizationId: 'org-1',
        targetUserId: 'u-2',
        defaultProjectRole: 'editor',
        actorUserId: 'u-1',
      }),
    ).rejects.toMatchObject({ code: 'SEAT_LIMIT_REACHED', status: 409 });
  });

  it('閲覧者へ落とすときは座席を確認しない (枠が空く方向なので)', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue(target);

    await changeDefaultProjectRole({
      organizationId: 'org-1',
      targetUserId: 'u-2',
      defaultProjectRole: 'viewer',
      actorUserId: 'u-1',
    });

    expect(getEntitlementMock).not.toHaveBeenCalled();
  });

  it('降格前に、管理者が 0 名になるプロジェクトが無いか全件確かめる', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue({
      id: 'om-1',
      orgRole: 'member',
      defaultProjectRole: 'admin',
    });
    prismaMock.projectMember.findMany.mockResolvedValue([
      { id: 'pm-1', projectId: 'p-1', roleType: 'admin' },
      { id: 'pm-2', projectId: 'p-2', roleType: 'editor' },
    ]);

    await changeDefaultProjectRole({
      organizationId: 'org-1',
      targetUserId: 'u-2',
      defaultProjectRole: 'editor',
      actorUserId: 'u-1',
    });

    // admin の行だけ検証すればよい
    expect(assertNotLastAdminMock).toHaveBeenCalledTimes(1);
    expect(assertNotLastAdminMock).toHaveBeenCalledWith('p-1', 'pm-1');
  });

  it('最後の管理者になる場合は書き換え前に失敗する', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue({
      id: 'om-1',
      orgRole: 'member',
      defaultProjectRole: 'admin',
    });
    prismaMock.projectMember.findMany.mockResolvedValue([
      { id: 'pm-1', projectId: 'p-1', roleType: 'admin' },
    ]);
    assertNotLastAdminMock.mockRejectedValueOnce(new Error('LAST_ADMIN'));

    await expect(
      changeDefaultProjectRole({
        organizationId: 'org-1',
        targetUserId: 'u-2',
        defaultProjectRole: 'viewer',
        actorUserId: 'u-1',
      }),
    ).rejects.toThrow();
    // 途中まで書き換わっていないこと
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('listMemberProjects', () => {
  it('参加プロジェクトごとにボール保持数を数える', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([
      { id: 'pm-1', roleType: 'editor', project: { id: 'p-1', name: 'A' } },
    ]);
    prismaMock.plan.findMany.mockResolvedValue([
      // 実施中 (ボールを持っている)
      {
        executorMemberId: 'pm-1',
        approverMemberId: null,
        progressManagerMemberId: null,
        toMemberId: null,
        status: 'active',
        item: { projectId: 'p-1' },
        ballEvents: [],
      },
      // TOSS 済み = 渡したあとなので数えない
      {
        executorMemberId: 'pm-1',
        approverMemberId: null,
        progressManagerMemberId: null,
        toMemberId: 'pm-other',
        status: 'active',
        item: { projectId: 'p-1' },
        ballEvents: [
          { eventType: 'tossed', source: 'human', occurredAt: new Date('2026-06-01T00:00:00Z') },
        ],
      },
    ]);

    const res = await listMemberProjects('org-1', 'u-2');

    expect(res).toEqual([
      { projectId: 'p-1', projectName: 'A', memberId: 'pm-1', roleType: 'editor', ballHolderCount: 1 },
    ]);
  });

  it('参加していなければ空配列を返し、予定を引かない', async () => {
    const res = await listMemberProjects('org-1', 'u-9');
    expect(res).toEqual([]);
    expect(prismaMock.plan.findMany).not.toHaveBeenCalled();
  });
});

describe('createOrgInvitation', () => {
  const body = { name: '横山 美咲', email: 'Yokoyama@Example.test', roleType: 'editor' as const };

  beforeEach(() => {
    prismaMock.organization.findUniqueOrThrow.mockResolvedValue({ name: 'テスト組織' });
    prismaMock.user.findUnique.mockResolvedValue({ displayName: '佐藤' });
    prismaMock.organizationMember.findFirst.mockResolvedValue(null);
    prismaMock.invitation.findFirst.mockResolvedValue(null);
    prismaMock.invitation.create.mockResolvedValue({ id: 'inv-1' });
  });

  it('メールを小文字化して招待を作り、招待メールを送る', async () => {
    const res = await createOrgInvitation({
      organizationId: 'org-1',
      actorUserId: 'u-1',
      origin: 'https://app.test',
      body,
    });

    expect(res.invitationId).toBe('inv-1');
    expect(prismaMock.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'yokoyama@example.test', roleType: 'editor' }),
      }),
    );
    expect(sendInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'yokoyama@example.test', projectName: 'テスト組織' }),
    );
  });

  it('既に会員なら 409 ALREADY_MEMBER', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue({ id: 'om-1' });

    await expect(
      createOrgInvitation({ organizationId: 'org-1', actorUserId: 'u-1', origin: '', body }),
    ).rejects.toMatchObject({ code: 'ALREADY_MEMBER', status: 409 });
  });

  it('招待中なら 409 INVITATION_ALREADY_SENT', async () => {
    prismaMock.invitation.findFirst.mockResolvedValue({ id: 'inv-0' });

    await expect(
      createOrgInvitation({ organizationId: 'org-1', actorUserId: 'u-1', origin: '', body }),
    ).rejects.toMatchObject({ code: 'INVITATION_ALREADY_SENT', status: 409 });
  });

  it('枠が無ければ 409 (重複チェックの後に判定する)', async () => {
    getEntitlementMock.mockResolvedValue(entitlement({ canInviteMember: false }));

    await expect(
      createOrgInvitation({ organizationId: 'org-1', actorUserId: 'u-1', origin: '', body }),
    ).rejects.toMatchObject({ code: 'SEAT_LIMIT_REACHED', status: 409 });
  });

  it('選ばれたプロジェクトに未紐付けの参加者行を作る', async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: 'p-1' });
    prismaMock.projectMember.findFirst.mockResolvedValue(null);

    await createOrgInvitation({
      organizationId: 'org-1',
      actorUserId: 'u-1',
      origin: '',
      body: { ...body, projectIds: ['p-1'] },
    });

    expect(prismaMock.projectMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'p-1',
          userId: null,
          roleType: 'editor',
          // 所属名 / 職種は users を正とする (#156)
          organizationName: '',
        }),
      }),
    );
  });

  it('既に参加者行があるプロジェクトは作り直さない', async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: 'p-1' });
    prismaMock.projectMember.findFirst.mockResolvedValue({ id: 'pm-1' });

    await createOrgInvitation({
      organizationId: 'org-1',
      actorUserId: 'u-1',
      origin: '',
      body: { ...body, projectIds: ['p-1'] },
    });

    expect(prismaMock.projectMember.create).not.toHaveBeenCalled();
  });

  it('別組織のプロジェクトを指定すると 404', async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);

    await expect(
      createOrgInvitation({
        organizationId: 'org-1',
        actorUserId: 'u-1',
        origin: '',
        body: { ...body, projectIds: ['p-other'] },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('メール送信に失敗しても招待は残し、警告を返す', async () => {
    sendInvitationMock.mockRejectedValue(new Error('smtp down'));

    const res = await createOrgInvitation({
      organizationId: 'org-1',
      actorUserId: 'u-1',
      origin: '',
      body,
    });

    expect(res.invitationId).toBe('inv-1');
    expect(res.warnings?.[0]).toContain('メールの送信に失敗');
  });
});

describe('revokeOrgInvitation', () => {
  it('未受諾の招待を失効させる', async () => {
    prismaMock.invitation.findFirst.mockResolvedValue({ id: 'inv-1' });

    await revokeOrgInvitation({
      organizationId: 'org-1',
      invitationId: 'inv-1',
      actorUserId: 'u-1',
    });

    expect(prismaMock.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1' } }),
    );
  });

  it('存在しない招待は 404', async () => {
    prismaMock.invitation.findFirst.mockResolvedValue(null);

    await expect(
      revokeOrgInvitation({ organizationId: 'org-1', invitationId: 'x', actorUserId: 'u-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('resendOrgInvitation', () => {
  beforeEach(() => {
    prismaMock.organization.findUniqueOrThrow.mockResolvedValue({ name: '制作会社A' });
    prismaMock.user.findUnique.mockResolvedValue({ displayName: '佐藤' });
  });

  it('新しいトークンで送り直し、期限も引き直す', async () => {
    prismaMock.invitation.findFirst.mockResolvedValue({
      id: 'inv-1',
      email: 'hanako@example.com',
    });

    const res = await resendOrgInvitation({
      organizationId: 'org-1',
      invitationId: 'inv-1',
      actorUserId: 'u-1',
      origin: 'https://app.test',
    });

    expect(sendInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'hanako@example.com',
        projectName: '制作会社A',
        acceptUrl: expect.stringMatching(/^https:\/\/app\.test\/invitations\/.+/),
      }),
    );
    // トークンのハッシュと期限が差し替わる (＝ 前のリンクは無効になる)
    const update = prismaMock.invitation.update.mock.calls[0]![0] as {
      where: { id: string };
      data: { tokenHash: string; expiresAt: Date };
    };
    expect(update.where.id).toBe('inv-1');
    expect(update.data.tokenHash).toEqual(expect.any(String));
    expect(update.data.expiresAt.toISOString()).toBe(res.expiresAt);
  });

  it('送信に失敗したらトークンを差し替えない (手元のリンクを道連れにしない)', async () => {
    prismaMock.invitation.findFirst.mockResolvedValue({
      id: 'inv-1',
      email: 'hanako@example.com',
    });
    sendInvitationMock.mockRejectedValue(new Error('smtp down'));

    await expect(
      resendOrgInvitation({
        organizationId: 'org-1',
        invitationId: 'inv-1',
        actorUserId: 'u-1',
        origin: 'https://app.test',
      }),
    ).rejects.toThrow('smtp down');

    expect(prismaMock.invitation.update).not.toHaveBeenCalled();
  });

  it('受諾済み・失効済み・他組織の招待は 404', async () => {
    prismaMock.invitation.findFirst.mockResolvedValue(null);

    await expect(
      resendOrgInvitation({
        organizationId: 'org-1',
        invitationId: 'x',
        actorUserId: 'u-1',
        origin: 'https://app.test',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(sendInvitationMock).not.toHaveBeenCalled();
  });
});
