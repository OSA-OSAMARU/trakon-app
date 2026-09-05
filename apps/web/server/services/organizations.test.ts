import { describe, expect, it, vi } from 'vitest';

import { ApiException } from '../lib/errors.js';
import {
  countActiveProjects,
  countSeats,
  defaultOrganizationName,
  ensureOrganizationForUser,
  ensureOrganizationMember,
  resolvePrimaryOrganization,
} from './organizations.js';

// 実 DB を使う経路は organizations.integration.test.ts が見る。
// ここでは DB を差し替えて、分岐 (既存/新規・論理削除からの復活・既定組織の解決) を固定する。

type Db = Parameters<typeof countSeats>[0];

function fakeDb(over: Record<string, unknown>): Db {
  return over as unknown as Db;
}

describe('defaultOrganizationName', () => {
  it('表示名から組織名を組み立てる', () => {
    expect(defaultOrganizationName('川津')).toBe('川津 の組織');
  });

  it('長すぎる表示名は列の長さ制限に収まるよう切り詰める', () => {
    const name = defaultOrganizationName('あ'.repeat(300));
    expect(name.length).toBeLessThanOrEqual(255);
    expect(name.endsWith(' の組織')).toBe(true);
  });
});

describe('ensureOrganizationForUser', () => {
  it('組織が無ければ組織とオーナー会員行を作る', async () => {
    const organizationCreate = vi.fn().mockResolvedValue({ id: 'org-1' });
    const memberCreate = vi.fn().mockResolvedValue({ id: 'om-1' });
    const db = fakeDb({
      organization: { findUnique: vi.fn().mockResolvedValue(null), create: organizationCreate },
      organizationMember: { create: memberCreate },
    });

    const result = await ensureOrganizationForUser(db, { userId: 'u-1', displayName: '川津' });

    expect(result).toEqual({ organizationId: 'org-1' });
    expect(organizationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: '川津 の組織', ownerUserId: 'u-1' } }),
    );
    // オーナーは is_primary 付きで入る (既定の所属組織になる)
    expect(memberCreate).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', userId: 'u-1', orgRole: 'owner', isPrimary: true },
    });
  });

  it('既に組織があれば作り直さない (サインアップ経路が複数あるため冪等)', async () => {
    const organizationCreate = vi.fn();
    const db = fakeDb({
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'org-1' }),
        create: organizationCreate,
      },
      organizationMember: {
        findUnique: vi.fn().mockResolvedValue({ id: 'om-1', deletedAt: null }),
        create: vi.fn(),
      },
    });

    const result = await ensureOrganizationForUser(db, { userId: 'u-1', displayName: '川津' });

    expect(result).toEqual({ organizationId: 'org-1' });
    expect(organizationCreate).not.toHaveBeenCalled();
  });
});

describe('ensureOrganizationMember', () => {
  it('会員行が無ければ作る (既定は member かつ is_primary なし)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'om-9' });
    const db = fakeDb({
      organizationMember: { findUnique: vi.fn().mockResolvedValue(null), create },
    });

    const result = await ensureOrganizationMember(db, { organizationId: 'org-1', userId: 'u-2' });

    expect(result).toEqual({ id: 'om-9', created: true });
    expect(create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', userId: 'u-2', orgRole: 'member', isPrimary: false },
      select: { id: true },
    });
  });

  it('論理削除済みの行は復活させる (uq_om_org_user がフル UNIQUE のため INSERT できない)', async () => {
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn();
    const db = fakeDb({
      organizationMember: {
        findUnique: vi.fn().mockResolvedValue({ id: 'om-3', deletedAt: new Date() }),
        update,
        create,
      },
    });

    const result = await ensureOrganizationMember(db, {
      organizationId: 'org-1',
      userId: 'u-2',
      orgRole: 'admin',
    });

    expect(result).toEqual({ id: 'om-3', created: true });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'om-3' },
        data: expect.objectContaining({ deletedAt: null, orgRole: 'admin' }),
      }),
    );
  });

  it('有効な行が既にあれば何もしない', async () => {
    const update = vi.fn();
    const create = vi.fn();
    const db = fakeDb({
      organizationMember: {
        findUnique: vi.fn().mockResolvedValue({ id: 'om-3', deletedAt: null }),
        update,
        create,
      },
    });

    const result = await ensureOrganizationMember(db, { organizationId: 'org-1', userId: 'u-2' });

    expect(result).toEqual({ id: 'om-3', created: false });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('resolvePrimaryOrganization', () => {
  it('is_primary を優先し、同点なら参加が早い順に選ぶ', async () => {
    const findFirst = vi.fn().mockResolvedValue({ organizationId: 'org-1', orgRole: 'owner' });
    const db = fakeDb({ organizationMember: { findFirst } });

    const result = await resolvePrimaryOrganization(db, 'u-1');

    expect(result).toEqual({ organizationId: 'org-1', orgRole: 'owner' });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ isPrimary: 'desc' }, { joinedAt: 'asc' }],
      }),
    );
  });

  it('削除済みの組織は既定の所属先にしない', async () => {
    const findFirst = vi.fn().mockResolvedValue({ organizationId: 'org-1', orgRole: 'member' });
    const db = fakeDb({ organizationMember: { findFirst } });

    await resolvePrimaryOrganization(db, 'u-1');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u-1', deletedAt: null, organization: { deletedAt: null } },
      }),
    );
  });

  it('どこにも所属していなければ 404', async () => {
    const db = fakeDb({ organizationMember: { findFirst: vi.fn().mockResolvedValue(null) } });

    await expect(resolvePrimaryOrganization(db, 'u-1')).rejects.toMatchObject({
      code: 'ORGANIZATION_NOT_FOUND',
      status: 404,
    });
    await expect(resolvePrimaryOrganization(db, 'u-1')).rejects.toBeInstanceOf(ApiException);
  });
});

describe('カウント', () => {
  it('座席は有効な組織メンバーと、未受諾で期限内の招待を足したもの', async () => {
    // 招待中も座席を押さえないと、大量に招待してから一斉受諾で上限を超えられる
    const memberCount = vi.fn().mockResolvedValue(3);
    const invitationCount = vi.fn().mockResolvedValue(2);
    const db = fakeDb({
      organizationMember: { count: memberCount },
      invitation: { count: invitationCount },
    });

    expect(await countSeats(db, 'org-1')).toBe(5);
    expect(memberCount).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', deletedAt: null },
    });
    expect(invitationCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: 'org-1',
        acceptedAt: null,
        revokedAt: null,
      }),
    });
  });

  it('プロジェクト数はアーカイブ済みを除く (アーカイブが枠を空ける動線)', async () => {
    const count = vi.fn().mockResolvedValue(2);
    const db = fakeDb({ project: { count } });

    expect(await countActiveProjects(db, 'org-1')).toBe(2);
    expect(count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', deletedAt: null, archivedAt: null },
    });
  });
});
