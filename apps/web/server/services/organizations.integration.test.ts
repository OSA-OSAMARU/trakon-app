import { prisma } from '@trakon/db';
import { describe, expect, it } from 'vitest';

import { createOrganization, createProject, createUser, primaryOrganizationId } from '../test/factories.js';
import {
  countActiveProjects,
  countSeats,
  defaultOrganizationName,
  ensureOrganizationForUser,
  ensureOrganizationMember,
  resolvePrimaryOrganization,
} from './organizations.js';

describe('ensureOrganizationForUser', () => {
  describe('正常系', () => {
    it('個人組織とオーナーの会員行を作る', async () => {
      const user = await createUser({ withOrganization: false });

      const { organizationId } = await ensureOrganizationForUser(prisma, {
        userId: user.id,
        displayName: user.displayName,
      });

      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      expect(org).toMatchObject({
        ownerUserId: user.id,
        name: defaultOrganizationName(user.displayName),
      });
      const member = await prisma.organizationMember.findFirst({ where: { organizationId } });
      expect(member).toMatchObject({ userId: user.id, orgRole: 'owner', isPrimary: true });
    });

    it('二重に呼んでも組織は 1 つのまま (冪等)', async () => {
      const user = await createUser({ withOrganization: false });

      const first = await ensureOrganizationForUser(prisma, {
        userId: user.id,
        displayName: user.displayName,
      });
      const second = await ensureOrganizationForUser(prisma, {
        userId: user.id,
        displayName: user.displayName,
      });

      expect(second.organizationId).toBe(first.organizationId);
      expect(await prisma.organization.count({ where: { ownerUserId: user.id } })).toBe(1);
      expect(await prisma.organizationMember.count({ where: { userId: user.id } })).toBe(1);
    });

    it('表示名が長くても組織名の長さ制限に収まる', async () => {
      const user = await createUser({ withOrganization: false, displayName: 'あ'.repeat(300) });

      const { organizationId } = await ensureOrganizationForUser(prisma, {
        userId: user.id,
        displayName: user.displayName,
      });

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
      expect(org.name.length).toBeLessThanOrEqual(255);
    });
  });
});

describe('ensureOrganizationMember', () => {
  describe('正常系', () => {
    it('会員を追加する', async () => {
      const owner = await createUser();
      const invitee = await createUser({ withOrganization: false });
      const organizationId = await primaryOrganizationId(owner.id);

      const result = await ensureOrganizationMember(prisma, {
        organizationId,
        userId: invitee.id,
      });

      expect(result.created).toBe(true);
      const row = await prisma.organizationMember.findFirstOrThrow({
        where: { organizationId, userId: invitee.id },
      });
      expect(row).toMatchObject({ orgRole: 'member', isPrimary: false, deletedAt: null });
    });

    it('既に会員なら何もしない', async () => {
      const owner = await createUser();
      const organizationId = await primaryOrganizationId(owner.id);

      const result = await ensureOrganizationMember(prisma, {
        organizationId,
        userId: owner.id,
      });

      expect(result.created).toBe(false);
      expect(await prisma.organizationMember.count({ where: { organizationId } })).toBe(1);
    });

    it('論理削除済みの会員行は復活させる (uq_om_org_user はフル UNIQUE のため)', async () => {
      const owner = await createUser();
      const invitee = await createUser({ withOrganization: false });
      const organizationId = await primaryOrganizationId(owner.id);
      const first = await ensureOrganizationMember(prisma, { organizationId, userId: invitee.id });
      await prisma.organizationMember.update({
        where: { id: first.id },
        data: { deletedAt: new Date() },
      });

      const again = await ensureOrganizationMember(prisma, { organizationId, userId: invitee.id });

      expect(again.id).toBe(first.id);
      expect(again.created).toBe(true);
      const row = await prisma.organizationMember.findUniqueOrThrow({ where: { id: first.id } });
      expect(row.deletedAt).toBeNull();
    });
  });
});

describe('resolvePrimaryOrganization', () => {
  describe('正常系', () => {
    it('is_primary の組織を優先して返す', async () => {
      const user = await createUser();
      const otherOwner = await createUser();
      const otherOrgId = await primaryOrganizationId(otherOwner.id);
      await ensureOrganizationMember(prisma, { organizationId: otherOrgId, userId: user.id });

      const resolved = await resolvePrimaryOrganization(prisma, user.id);

      expect(resolved).toEqual({
        organizationId: await primaryOrganizationId(user.id),
        orgRole: 'owner',
      });
    });

    it('is_primary が無ければ最初に参加した組織を返す', async () => {
      const user = await createUser({ withOrganization: false });
      const owner = await createUser();
      const organizationId = await primaryOrganizationId(owner.id);
      await ensureOrganizationMember(prisma, { organizationId, userId: user.id });

      const resolved = await resolvePrimaryOrganization(prisma, user.id);

      expect(resolved).toEqual({ organizationId, orgRole: 'member' });
    });
  });

  describe('異常系', () => {
    it('どこにも所属していなければ 404', async () => {
      const user = await createUser({ withOrganization: false });

      await expect(resolvePrimaryOrganization(prisma, user.id)).rejects.toMatchObject({
        code: 'ORGANIZATION_NOT_FOUND',
        status: 404,
      });
    });

    it('論理削除された会員行は所属とみなさない', async () => {
      const user = await createUser();
      const organizationId = await primaryOrganizationId(user.id);
      await prisma.organizationMember.updateMany({
        where: { organizationId, userId: user.id },
        data: { deletedAt: new Date() },
      });

      await expect(resolvePrimaryOrganization(prisma, user.id)).rejects.toMatchObject({
        code: 'ORGANIZATION_NOT_FOUND',
      });
    });
  });
});

describe('countSeats / countActiveProjects', () => {
  it('有効な会員だけを座席として数える', async () => {
    const owner = await createUser();
    const invitee = await createUser({ withOrganization: false });
    const organizationId = await primaryOrganizationId(owner.id);
    const added = await ensureOrganizationMember(prisma, { organizationId, userId: invitee.id });

    expect(await countSeats(prisma, organizationId)).toBe(2);

    await prisma.organizationMember.update({
      where: { id: added.id },
      data: { deletedAt: new Date() },
    });
    expect(await countSeats(prisma, organizationId)).toBe(1);
  });

  it('アーカイブ済み・論理削除済みのプロジェクトは数えない (枠を空ける動線)', async () => {
    const user = await createUser();
    const organizationId = await primaryOrganizationId(user.id);
    await createProject({ createdBy: user.id });
    await createProject({ createdBy: user.id, archivedAt: new Date() });
    const deleted = await createProject({ createdBy: user.id });
    await prisma.project.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    expect(await countActiveProjects(prisma, organizationId)).toBe(1);
  });

  it('別組織のプロジェクトは数えない', async () => {
    const user = await createUser();
    const other = await createUser();
    await createProject({ createdBy: user.id });
    await createProject({ createdBy: other.id });

    expect(await countActiveProjects(prisma, await primaryOrganizationId(user.id))).toBe(1);
  });
});

describe('projects.organization_id', () => {
  it('組織を削除しようとするとプロジェクトが残っている限り拒否される (FR-BILL-09 の裏付け)', async () => {
    const user = await createUser();
    const organizationId = await primaryOrganizationId(user.id);
    await createProject({ createdBy: user.id });

    await expect(prisma.organization.delete({ where: { id: organizationId } })).rejects.toThrow();
  });

  it('明示的に組織を指定してプロジェクトを作れる', async () => {
    const owner = await createUser();
    const member = await createUser({ withOrganization: false });
    const org = await prisma.organization.findFirstOrThrow({ where: { ownerUserId: owner.id } });
    await ensureOrganizationMember(prisma, { organizationId: org.id, userId: member.id });

    const project = await createProject({ createdBy: member.id, organizationId: org.id });

    expect(project.organizationId).toBe(org.id);
  });
});

describe('createOrganization ファクトリ', () => {
  it('オーナー行つきで組織を作る', async () => {
    const user = await createUser({ withOrganization: false });

    const org = await createOrganization({ ownerUserId: user.id, name: 'テスト組織' });

    expect(org.name).toBe('テスト組織');
    expect(await countSeats(prisma, org.id)).toBe(1);
  });
});
