import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getFrozenProjectIds, isProjectFrozen, setRetainedProjects } from './freeze.js';

// 凍結状態は保存せず都度計算する (設計書 §7.11)。
// ここでは「何を凍結対象と判断するか」「維持指定をどう採番するか」を固定する。

const prismaMock = vi.hoisted(() => ({
  billingSubscription: { findUnique: vi.fn() },
  organizationMember: { count: vi.fn() },
  project: { count: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

const project = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  createdAt: new Date(`2026-01-0${id.at(-1)}`),
  archivedAt: null,
  retainedAt: null,
  ...over,
});

beforeEach(() => {
  prismaMock.billingSubscription.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.organizationMember.count.mockReset().mockResolvedValue(1);
  prismaMock.project.count.mockReset().mockResolvedValue(0);
  prismaMock.project.findMany.mockReset().mockResolvedValue([]);
  prismaMock.project.update.mockReset().mockReturnValue({});
  prismaMock.project.updateMany.mockReset().mockReturnValue({});
  prismaMock.auditLog.create.mockReset().mockReturnValue({});
  prismaMock.$transaction.mockReset().mockResolvedValue([]);
});

describe('getFrozenProjectIds', () => {
  it('Free の上限 (2 件) を超えた分を凍結対象にする', async () => {
    prismaMock.project.findMany.mockResolvedValue([project('p1'), project('p2'), project('p3')]);
    prismaMock.project.count.mockResolvedValue(3);

    expect(await getFrozenProjectIds('org-1')).toEqual(['p3']);
  });

  it('アーカイブ済みは凍結対象にしない (枠を空ける正規の動線)', async () => {
    prismaMock.project.findMany.mockResolvedValue([
      project('p1'),
      project('p2'),
      project('p3', { archivedAt: new Date() }),
    ]);

    expect(await getFrozenProjectIds('org-1')).toEqual([]);
  });

  it('維持指定があるものを優先して残す', async () => {
    prismaMock.project.findMany.mockResolvedValue([
      project('p1'),
      project('p2'),
      project('p3', { retainedAt: new Date('2026-06-01') }),
    ]);

    expect(await getFrozenProjectIds('org-1')).toEqual(['p2']);
  });

  it('上限が無いプランでは何も凍結しない', async () => {
    prismaMock.billingSubscription.findUnique.mockResolvedValue({
      planCode: 'team',
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      gracePeriodEndsAt: null,
    });
    prismaMock.project.findMany.mockResolvedValue([project('p1'), project('p2'), project('p3')]);

    expect(await getFrozenProjectIds('org-1')).toEqual([]);
  });
});

describe('isProjectFrozen', () => {
  beforeEach(() => {
    prismaMock.project.findMany.mockResolvedValue([project('p1'), project('p2'), project('p3')]);
  });

  it('超過分は凍結されている', async () => {
    expect(await isProjectFrozen('org-1', 'p3')).toBe(true);
  });

  it('上限内は凍結されていない', async () => {
    expect(await isProjectFrozen('org-1', 'p1')).toBe(false);
  });
});

describe('setRetainedProjects', () => {
  beforeEach(() => {
    prismaMock.project.findMany.mockResolvedValue([project('p1'), project('p2'), project('p3')]);
  });

  it('一度すべてクリアしてから、指定順に新しい時刻を振る', async () => {
    await setRetainedProjects({
      organizationId: 'org-1',
      projectIds: ['p3', 'p1'],
      actorUserId: 'u-1',
    });

    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: { retainedAt: null },
    });
    const [first, second] = prismaMock.project.update.mock.calls.map(
      (c) => c[0] as { where: { id: string }; data: { retainedAt: Date } },
    );
    expect(first!.where.id).toBe('p3');
    expect(second!.where.id).toBe('p1');
    // 先頭ほど新しい = 維持指定が新しい順に並ぶ
    expect(first!.data.retainedAt.getTime()).toBeGreaterThan(second!.data.retainedAt.getTime());
  });

  it('選び直した結果の凍結対象を返す', async () => {
    // 1 回目 = 所有チェック、2 回目 = 採番後の凍結判定
    prismaMock.project.findMany
      .mockResolvedValueOnce([project('p1'), project('p2'), project('p3')])
      .mockResolvedValueOnce([
        project('p1', { retainedAt: new Date('2026-07-01') }),
        project('p2'),
        project('p3', { retainedAt: new Date('2026-07-02') }),
      ]);

    const result = await setRetainedProjects({
      organizationId: 'org-1',
      projectIds: ['p3', 'p1'],
      actorUserId: 'u-1',
    });

    expect(result.retainedIds).toEqual(['p3', 'p1']);
    expect(result.frozenIds).toEqual(['p2']);
  });

  it('監査ログを残す', async () => {
    await setRetainedProjects({ organizationId: 'org-1', projectIds: ['p1'], actorUserId: 'u-1' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'retained_projects_changed',
        resourceType: 'organization',
        resourceId: 'org-1',
      }),
    });
  });

  it('上限を超える件数の維持指定は 409', async () => {
    await expect(
      setRetainedProjects({
        organizationId: 'org-1',
        projectIds: ['p1', 'p2', 'p3'],
        actorUserId: 'u-1',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_LIMIT_REACHED', status: 409 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('他組織のプロジェクトを指定されたら 404', async () => {
    await expect(
      setRetainedProjects({ organizationId: 'org-1', projectIds: ['p9'], actorUserId: 'u-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('プロジェクトを削除しない (超過分は閲覧のみにする)', async () => {
    await setRetainedProjects({ organizationId: 'org-1', projectIds: ['p1'], actorUserId: 'u-1' });

    expect(prismaMock.project).not.toHaveProperty('delete');
    expect(prismaMock.project).not.toHaveProperty('deleteMany');
  });
});
