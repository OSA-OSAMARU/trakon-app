import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  listProjects as ListProjectsType,
  getProjectDetail as GetProjectDetailType,
  createProject as CreateProjectType,
  updateProject as UpdateProjectType,
  archiveProject as ArchiveProjectType,
  unarchiveProject as UnarchiveProjectType,
} from './projects.js';

// =============================================================================
// Mocks
// =============================================================================

type MockProject = {
  id: string;
  name: string;
  clientName: string | null;
  progressManagerMemberId?: string | null;
  startDate: Date;
  endDate: Date;
  status: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};
type MockUser = { id: string; displayName: string; email: string };
type MockItem = { projectId: string; name: string; sortOrder: number };
type MockMember = {
  projectId: string;
  userId: string | null;
  name: string;
  email: string;
  organizationName: string;
  memberType: string;
  sortOrder: number;
};

const projectStore: Record<string, MockProject> = {};
const userStore: Record<string, MockUser> = {};
const itemStore: MockItem[] = [];
const memberStore: MockMember[] = [];

let nextId = 1;
const newId = (prefix: string) => `${prefix}-${nextId++}`;

// project_members の where (some) にマッチするかを判定するヘルパ。
// service が渡す where は { deletedAt: null, archivedAt: ..., members: { some: { userId, deletedAt: null } } }
function projectMatchesListWhere(
  p: MockProject,
  where: {
    deletedAt: null;
    archivedAt: null | { not: null };
    members: { some: { userId: string; deletedAt: null } };
  },
): boolean {
  if (p.deletedAt !== null) return false;
  // archivedAt: null なら未アーカイブのみ、{ not: null } ならアーカイブ済みのみ
  if (where.archivedAt === null) {
    if (p.archivedAt !== null) return false;
  } else if (p.archivedAt === null) {
    return false;
  }
  const wantUserId = where.members.some.userId;
  const isMember = memberStore.some((m) => m.projectId === p.id && m.userId === wantUserId);
  return isMember;
}

function countMembers(projectId: string): number {
  return memberStore.filter((m) => m.projectId === projectId).length;
}
function countItems(projectId: string): number {
  return itemStore.filter((i) => i.projectId === projectId).length;
}

// $transaction のコールバックに渡す tx クライアント (project / projectItem / projectMember)
const txClient = {
  project: {
    create: vi.fn(async ({ data }: { data: Omit<MockProject, 'id' | 'status' | 'archivedAt' | 'deletedAt' | 'createdAt' | 'updatedAt'> }) => {
      const p: MockProject = {
        id: newId('p'),
        status: 'active',
        archivedAt: null,
        deletedAt: null,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-06-01T00:00:00Z'),
        ...data,
      };
      projectStore[p.id] = p;
      return p;
    }),
    // #147: 参加者を作ったあとに進行責任者をセットする
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MockProject> }) => {
      const p = projectStore[where.id];
      if (!p) throw new Error('record not found');
      Object.assign(p, data);
      return p;
    }),
  },
  projectItem: {
    createMany: vi.fn(async ({ data }: { data: MockItem[] }) => {
      itemStore.push(...data);
      return { count: data.length };
    }),
  },
  projectMember: {
    create: vi.fn(async ({ data }: { data: MockMember }) => {
      memberStore.push(data);
      return { ...data, id: newId('m') };
    }),
    createMany: vi.fn(async ({ data }: { data: MockMember[] }) => {
      memberStore.push(...data);
      return { count: data.length };
    }),
  },
};

const prismaMock = {
  user: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return userStore[where.id] ?? null;
    }),
  },
  project: {
    findMany: vi.fn(
      async ({
        where,
        take,
        skip,
      }: {
        where: Parameters<typeof projectMatchesListWhere>[1];
        orderBy: unknown;
        take: number;
        skip: number;
      }) => {
        const matched = Object.values(projectStore).filter((p) =>
          projectMatchesListWhere(p, where),
        );
        // service は include: { progressManager } を読む (未設定は null)
        return matched.slice(skip, skip + take).map((p) => ({ ...p, progressManager: null }));
      },
    ),
    count: vi.fn(async ({ where }: { where: Parameters<typeof projectMatchesListWhere>[1] }) => {
      return Object.values(projectStore).filter((p) => projectMatchesListWhere(p, where)).length;
    }),
    findFirst: vi.fn(
      async ({ where }: { where: { id: string; deletedAt: null }; include: unknown }) => {
        const p = projectStore[where.id];
        if (!p || p.deletedAt !== null) return null;
        // service は _count.members / _count.items を読む
        return {
          ...p,
          progressManager: null,
          _count: { members: countMembers(p.id), items: countItems(p.id) },
        };
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<MockProject>;
      }) => {
        const p = projectStore[where.id];
        if (!p) throw new Error('record not found');
        Object.assign(p, data);
        p.updatedAt = new Date('2026-06-02T00:00:00Z');
        return p;
      },
    ),
  },
  // #147: 一覧・詳細で期限超過ボール数を数えるために plan を読む。
  // このテストでは予定を持たない前提なので常に空配列。
  plan: {
    findMany: vi.fn(async () => []),
  },
  // 作成者の既定の所属組織を解決する (projects.organization_id は NOT NULL)。
  organizationMember: {
    findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
      userStore[where.userId] ? { organizationId: `org-${where.userId}`, orgRole: 'owner' } : null,
    ),
    count: vi.fn(async () => 1),
  },
  // プロジェクト数上限の判定 (§7.11.1)。既定は Team (無制限) にして
  // 上限そのものの検証は統合テストへ寄せる。
  billingSubscription: {
    findUnique: vi.fn(async () => ({
      planCode: 'team',
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      gracePeriodEndsAt: null,
    })),
  },
  invitation: { count: vi.fn(async () => 0) },
  // コールバック形式 ($transaction(fn)) のみ service は使用。
  $transaction: vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => Promise<unknown>)(txClient);
  }),
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// =============================================================================
// Tests
// =============================================================================

let listProjects: typeof ListProjectsType;
let getProjectDetail: typeof GetProjectDetailType;
let createProject: typeof CreateProjectType;
let updateProject: typeof UpdateProjectType;
let archiveProject: typeof ArchiveProjectType;
let unarchiveProject: typeof UnarchiveProjectType;

beforeAll(async () => {
  ({
    listProjects,
    getProjectDetail,
    createProject,
    updateProject,
    archiveProject,
    unarchiveProject,
  } = await import('./projects.js'));
});

afterEach(() => {
  for (const k of Object.keys(projectStore)) delete projectStore[k];
  for (const k of Object.keys(userStore)) delete userStore[k];
  itemStore.length = 0;
  memberStore.length = 0;
  vi.clearAllMocks();
});

// テスト用ヘルパ: プロジェクトとメンバー行を直接 store に投入する。
function seedProject(p: Partial<MockProject> & { id: string; createdBy: string }): MockProject {
  const full: MockProject = {
    name: 'Seed Project',
    clientName: null,
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-12-31T00:00:00Z'),
    status: 'active',
    archivedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...p,
  };
  projectStore[full.id] = full;
  return full;
}

describe('createProject', () => {
  const body = {
    name: '新規プロジェクト',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    items: [{ name: '台本' }, { name: '撮影' }],
    members: [
      { name: '田中', email: 'tanaka@example.com', organizationName: 'A社', memberType: 'client' as const, roleType: 'viewer' as const },
      { name: '鈴木', email: 'suzuki@example.com', organizationName: '', memberType: 'production' as const, roleType: 'editor' as const },
    ],
  };

  it('プロジェクト・制作物・メンバー (作成者+招待先) を 1 トランザクションで作成し詳細を返す', async () => {
    userStore['u-1'] = { id: 'u-1', displayName: '河津', email: 'kawazu@example.com' };

    const res = await createProject({ body, currentUserId: 'u-1' });

    // 詳細 DTO が返る
    expect(res).toMatchObject({
      name: '新規プロジェクト',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      status: 'active',
      role: 'admin', // createdBy === currentUserId (FR-ROLE-04)
      createdBy: 'u-1',
    });
    // counts: メンバー = 作成者 1 + 招待先 2、制作物 = 2
    expect(res.counts).toEqual({ memberCount: 3, itemCount: 2 });

    // 制作物は sortOrder 連番で投入される
    expect(itemStore).toHaveLength(2);
    expect(itemStore.map((i) => i.sortOrder)).toEqual([0, 1]);

    // 作成者本人は userId 紐付き・sortOrder 0、招待先は userId NULL
    const creator = memberStore.find((m) => m.userId === 'u-1');
    expect(creator).toMatchObject({ name: '河津', email: 'kawazu@example.com', sortOrder: 0 });
    const invited = memberStore.filter((m) => m.userId === null);
    expect(invited.map((m) => m.email)).toEqual(['tanaka@example.com', 'suzuki@example.com']);
    expect(invited.map((m) => m.sortOrder)).toEqual([1, 2]);

    expect(txClient.projectItem.createMany).toHaveBeenCalledTimes(1);
    // #147: 進行責任者に据える参加者の id を拾うため、参加者は 1 件ずつ作る
    // (作成者 1 + 招待先 2 = 3 回)
    expect(txClient.projectMember.create).toHaveBeenCalledTimes(3);
  });

  it('作成者と同一メールのメンバー入力は除外される (大小文字無視)', async () => {
    userStore['u-1'] = { id: 'u-1', displayName: '河津', email: 'Kawazu@Example.com' };
    const dup = {
      ...body,
      members: [
        { name: '本人重複', email: 'kawazu@example.com', organizationName: '', memberType: 'production' as const, roleType: 'editor' as const },
        { name: '田中', email: 'tanaka@example.com', organizationName: '', memberType: 'client' as const, roleType: 'viewer' as const },
      ],
    };

    const res = await createProject({ body: dup, currentUserId: 'u-1' });

    // 作成者 1 + 重複除外後の招待先 1 = 2
    expect(res.counts.memberCount).toBe(2);
    const invited = memberStore.filter((m) => m.userId === null);
    expect(invited.map((m) => m.email)).toEqual(['tanaka@example.com']);
  });

  it('制作物 0 件・招待先 0 件のとき createMany は呼ばれず作成者のみ', async () => {
    userStore['u-1'] = { id: 'u-1', displayName: '河津', email: 'kawazu@example.com' };
    const minimal = { ...body, items: [], members: [] };

    const res = await createProject({ body: minimal, currentUserId: 'u-1' });

    expect(res.counts).toEqual({ memberCount: 1, itemCount: 0 });
    expect(txClient.projectItem.createMany).not.toHaveBeenCalled();
    // 招待先 0 件なので作成者の 1 回だけ
    expect(txClient.projectMember.create).toHaveBeenCalledTimes(1);
    expect(txClient.projectMember.create).toHaveBeenCalledTimes(1);
  });

  it('作成者プロフィールが無いと 404 PROFILE_NOT_COMPLETED', async () => {
    await expect(createProject({ body, currentUserId: 'missing' })).rejects.toMatchObject({
      code: 'PROFILE_NOT_COMPLETED',
      status: 404,
    });
  });
});

describe('listProjects', () => {
  it('自分が参加しているプロジェクトのみ未アーカイブで返す', async () => {
    seedProject({ id: 'p-own', createdBy: 'u-1', updatedAt: new Date('2026-06-10T00:00:00Z') });
    seedProject({ id: 'p-other', createdBy: 'u-2' });
    seedProject({ id: 'p-archived', createdBy: 'u-1', archivedAt: new Date('2026-06-05T00:00:00Z') });
    memberStore.push(
      { projectId: 'p-own', userId: 'u-1', name: 'a', email: 'a@x', organizationName: '', memberType: 'production', sortOrder: 0 },
      { projectId: 'p-other', userId: 'u-2', name: 'b', email: 'b@x', organizationName: '', memberType: 'production', sortOrder: 0 },
      { projectId: 'p-archived', userId: 'u-1', name: 'a', email: 'a@x', organizationName: '', memberType: 'production', sortOrder: 0 },
    );

    const res = await listProjects('u-1', { limit: 50, offset: 0 });

    expect(res.total).toBe(1);
    expect(res.items.map((p) => p.id)).toEqual(['p-own']);
    expect(res.items[0]?.role).toBe('admin');
  });

  it('archived=true でアーカイブ済みのみ返す', async () => {
    seedProject({ id: 'p-own', createdBy: 'u-1' });
    seedProject({ id: 'p-archived', createdBy: 'u-2', archivedAt: new Date('2026-06-05T00:00:00Z') });
    memberStore.push(
      { projectId: 'p-own', userId: 'u-1', name: 'a', email: 'a@x', organizationName: '', memberType: 'production', sortOrder: 0 },
      { projectId: 'p-archived', userId: 'u-1', name: 'a', email: 'a@x', organizationName: '', memberType: 'production', sortOrder: 0 },
    );

    const res = await listProjects('u-1', { archived: true, limit: 50, offset: 0 });

    expect(res.total).toBe(1);
    expect(res.items[0]?.id).toBe('p-archived');
    expect(res.items[0]?.archivedAt).not.toBeNull();
    // 作成者でないので member ロール
    expect(res.items[0]?.role).toBe('editor');
  });

  it('limit / offset でページングする', async () => {
    for (const id of ['p-a', 'p-b', 'p-c']) {
      seedProject({ id, createdBy: 'u-1' });
      memberStore.push({ projectId: id, userId: 'u-1', name: 'a', email: 'a@x', organizationName: '', memberType: 'production', sortOrder: 0 });
    }

    const res = await listProjects('u-1', { limit: 2, offset: 1 });

    expect(res.total).toBe(3);
    expect(res.items).toHaveLength(2);
  });
});

describe('getProjectDetail', () => {
  it('counts (memberCount / itemCount) を含む詳細を返す', async () => {
    seedProject({ id: 'p-1', createdBy: 'u-1' });
    memberStore.push(
      { projectId: 'p-1', userId: 'u-1', name: 'a', email: 'a@x', organizationName: '', memberType: 'production', sortOrder: 0 },
      { projectId: 'p-1', userId: null, name: 'b', email: 'b@x', organizationName: '', memberType: 'client', sortOrder: 1 },
    );
    itemStore.push({ projectId: 'p-1', name: 'i1', sortOrder: 0 });

    const res = await getProjectDetail('p-1', 'u-1');

    expect(res.id).toBe('p-1');
    expect(res.counts).toEqual({ memberCount: 2, itemCount: 1 });
    expect(res.role).toBe('admin');
  });

  it('作成者以外には member 行の role_type を返す (既定は editor)', async () => {
    seedProject({ id: 'p-1', createdBy: 'u-owner' });
    const res = await getProjectDetail('p-1', 'u-viewer');
    expect(res.role).toBe('editor');
  });

  it('存在しない / 削除済みは 404 NOT_FOUND', async () => {
    seedProject({ id: 'p-del', createdBy: 'u-1', deletedAt: new Date() });

    await expect(getProjectDetail('p-none', 'u-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await expect(getProjectDetail('p-del', 'u-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

describe('updateProject', () => {
  it('指定フィールドのみ更新し詳細 + 空 warnings を返す', async () => {
    seedProject({ id: 'p-1', createdBy: 'u-1', name: '旧名', status: 'active' });
    memberStore.push({ projectId: 'p-1', userId: 'u-1', name: 'a', email: 'a@x', organizationName: '', memberType: 'production', sortOrder: 0 });

    const res = await updateProject({
      projectId: 'p-1',
      body: { name: '新名', startDate: '2026-08-01', endDate: '2026-08-31', status: 'closed' },
      currentUserId: 'u-1',
    });

    expect(res.warnings).toEqual([]);
    expect(res.project.name).toBe('新名');
    expect(res.project.status).toBe('closed');
    expect(res.project.startDate).toBe('2026-08-01');
    expect(res.project.endDate).toBe('2026-08-31');
    // update に渡された data を検証 (全フィールド)
    const call = prismaMock.project.update.mock.calls.find((c) => (c[0] as { where: { id: string } }).where.id === 'p-1');
    expect(call?.[0]).toMatchObject({
      where: { id: 'p-1' },
      data: { name: '新名', status: 'closed' },
    });
  });

  it('未指定フィールドは data に含まれない (部分更新)', async () => {
    seedProject({ id: 'p-1', createdBy: 'u-1', name: '旧名' });

    await updateProject({ projectId: 'p-1', body: { name: 'のみ' }, currentUserId: 'u-1' });

    const call = prismaMock.project.update.mock.calls[0];
    const data = (call?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ name: 'のみ' });
    expect(data).not.toHaveProperty('startDate');
    expect(data).not.toHaveProperty('status');
  });
});

describe('archiveProject', () => {
  it('archivedAt を立てて詳細を返す', async () => {
    seedProject({ id: 'p-1', createdBy: 'u-1' });

    const res = await archiveProject({ projectId: 'p-1', currentUserId: 'u-1' });

    expect(projectStore['p-1']?.archivedAt).toBeInstanceOf(Date);
    expect(res.archivedAt).not.toBeNull();
  });
});

describe('unarchiveProject', () => {
  it('archivedAt を null にして詳細を返す', async () => {
    seedProject({ id: 'p-1', createdBy: 'u-1', archivedAt: new Date('2026-06-05T00:00:00Z') });

    const res = await unarchiveProject({ projectId: 'p-1', currentUserId: 'u-1' });

    expect(projectStore['p-1']?.archivedAt).toBeNull();
    expect(res.archivedAt).toBeNull();
  });
});
