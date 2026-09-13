import { Hono } from 'hono';

import { prisma } from '@trakon/db';
import { JOB_TITLES, ORG_ROLES, PROJECT_ROLES } from '@trakon/shared';
import { z } from 'zod';

import { ApiException } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgBillingRole, requireOrgMember } from '../../middleware/orgAuth.js';
import { attachCurrentUserId } from '../../middleware/projectAuth.js';
import { retainedProjectsBodySchema } from '../../schemas/billing.js';
import { setRetainedProjects } from '../../services/billing/freeze.js';
import {
  changeDefaultProjectRole,
  createOrgInvitation,
  listMemberProjects,
  listOrgMembers,
  revokeOrgInvitation,
} from '../../services/orgMembers.js';

const updateOrgMemberBodySchema = z
  .object({
    orgRole: z.enum(ORG_ROLES).optional(),
    /** 画面の「権限」列 (#160)。参加中の全プロジェクトへ反映される */
    defaultProjectRole: z.enum(PROJECT_ROLES).optional(),
  })
  .refine((v) => v.orgRole !== undefined || v.defaultProjectRole !== undefined, {
    message: 'At least one field must be provided.',
  });

const createOrgInvitationBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(320),
  organizationName: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(255).optional(),
  ),
  jobTitle: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.enum(JOB_TITLES).nullable().optional(),
  ),
  roleType: z.enum(PROJECT_ROLES),
  /** 任意。未選択でも招待できる (組織に招いてから割り当てる運用も可) */
  projectIds: z.array(z.string().uuid()).max(50).optional(),
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

  /**
   * 会員 (座席) の一覧。**保留中の招待も混ぜて返す** (#160)。
   *
   * 認可を requireOrgBillingRole に引き上げている。同僚の通知先メール・所属・職種を
   * 返すようになったため、一般の会員には見せない (設計書 §3.4b)。
   */
  .get('/me/members', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    return c.json({ data: await listOrgMembers(organizationId) });
  })

  /** 参加PJ ドロワー (#160)。ボール保持数つきで返す */
  .get('/me/members/:userId/projects', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    const userId = c.req.param('userId');
    return c.json({ data: await listMemberProjects(organizationId, userId) });
  })

  /** 組織単位の招待を作る (#160) */
  .post('/me/invitations', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    const body = createOrgInvitationBodySchema.parse(await c.req.json());
    const origin = new URL(c.req.url).origin;
    const result = await createOrgInvitation({
      organizationId,
      actorUserId: c.get('currentUserId'),
      origin,
      body,
    });
    return c.json({ data: { id: result.invitationId }, ...(result.warnings ? { warnings: result.warnings } : {}) }, 201);
  })

  /** 招待の取り消し = 枠の解放 (#160) */
  .delete('/me/invitations/:invitationId', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    await revokeOrgInvitation({
      organizationId,
      invitationId: c.req.param('invitationId'),
      actorUserId: c.get('currentUserId'),
    });
    return c.body(null, 204);
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
    if (body.orgRole !== undefined && target.orgRole === 'owner') {
      throw new ApiException('CANNOT_CHANGE_OWNER', 409, '組織のオーナーは変更できません。');
    }

    if (body.orgRole !== undefined) {
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
    }

    // 権限 (#160) は参加中の全プロジェクトへ反映する。
    // 座席の空き・最後の管理者の検証もこの中で行う。
    const roleResult =
      body.defaultProjectRole !== undefined
        ? await changeDefaultProjectRole({
            organizationId,
            targetUserId: userId,
            defaultProjectRole: body.defaultProjectRole,
            actorUserId: c.get('currentUserId'),
          })
        : null;

    return c.json({
      data: {
        userId,
        orgRole: body.orgRole ?? target.orgRole,
        defaultProjectRole: roleResult?.defaultProjectRole ?? null,
        affectedProjectIds: roleResult?.affectedProjectIds ?? [],
      },
    });
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
