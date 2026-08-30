import { Hono } from 'hono';

import { prisma } from '@trakon/db';
import { ORG_ROLES, type OrgRole } from '@trakon/shared';
import { z } from 'zod';

import { ApiException } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgBillingRole, requireOrgMember } from '../../middleware/orgAuth.js';
import { attachCurrentUserId } from '../../middleware/projectAuth.js';
import { retainedProjectsBodySchema } from '../../schemas/billing.js';
import { setRetainedProjects } from '../../services/billing/freeze.js';

const updateOrgMemberBodySchema = z.object({
  orgRole: z.enum(ORG_ROLES),
});

/**
 * `/api/v1/organizations/me` — 設計書 §3.4b
 *
 * 組織の会員アカウント (座席) 管理と、上限超過時に維持するプロジェクトの選択。
 */
export const organizationsRoute = new Hono()
  .use('*', requireAuth())
  .use('*', attachCurrentUserId())
  .use('*', requireOrgMember())

  .get('/me/members', async (c) => {
    const { organizationId } = c.get('organization');
    const rows = await prisma.organizationMember.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ orgRole: 'asc' }, { joinedAt: 'asc' }],
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
    return c.json({
      data: rows.map((m) => ({
        userId: m.userId,
        orgRole: m.orgRole as OrgRole,
        displayName: m.user.displayName,
        email: m.user.email,
        joinedAt: m.joinedAt.toISOString(),
      })),
    });
  })

  .patch('/me/members/:userId', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    const userId = c.req.param('userId');
    const body = updateOrgMemberBodySchema.parse(await c.req.json());

    const target = await prisma.organizationMember.findFirst({
      where: { organizationId, userId, deletedAt: null },
      select: { id: true, orgRole: true },
    });
    if (!target) throw new ApiException('NOT_FOUND', 404, 'Organization member not found.');

    // オーナーは 1 名固定。降格させると課金操作の主体が居なくなる
    if (target.orgRole === 'owner') {
      throw new ApiException('CANNOT_CHANGE_OWNER', 409, '組織のオーナーは変更できません。');
    }

    await prisma.$transaction([
      prisma.organizationMember.update({
        where: { id: target.id },
        data: { orgRole: body.orgRole },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: c.get('currentUserId'),
          action: 'org_role_changed',
          resourceType: 'organization',
          resourceId: organizationId,
          result: 'success',
          extra: { targetUserId: userId, from: target.orgRole, to: body.orgRole },
        },
      }),
    ]);

    return c.json({ data: { userId, orgRole: body.orgRole } });
  })

  .delete('/me/members/:userId', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    const userId = c.req.param('userId');

    const target = await prisma.organizationMember.findFirst({
      where: { organizationId, userId, deletedAt: null },
      select: { id: true, orgRole: true },
    });
    if (!target) throw new ApiException('NOT_FOUND', 404, 'Organization member not found.');
    if (target.orgRole === 'owner') {
      throw new ApiException('CANNOT_REMOVE_OWNER', 409, '組織のオーナーは除外できません。');
    }

    // 論理削除で座席を解放する。プロジェクト側の参加者行はそのまま残す
    // (解約・整理でデータを消さない方針、FR-BILL-09)。
    await prisma.$transaction([
      prisma.organizationMember.update({
        where: { id: target.id },
        data: { deletedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: c.get('currentUserId'),
          action: 'org_member_removed',
          resourceType: 'organization',
          resourceId: organizationId,
          result: 'success',
          extra: { targetUserId: userId },
        },
      }),
    ]);

    return c.body(null, 204);
  })

  .post('/me/retained-projects', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    const body = retainedProjectsBodySchema.parse(await c.req.json());
    const result = await setRetainedProjects({
      organizationId,
      projectIds: body.projectIds,
      actorUserId: c.get('currentUserId'),
    });
    return c.json({ data: result });
  });
