import { Hono } from 'hono';

import { ApiException } from '../../lib/errors.js';
import { resolveRequestOrigin } from '../../lib/requestOrigin.js';
import { requireProjectAction, requireProjectMember } from '../../middleware/projectAuth.js';
import { createInvitationBodySchema } from '../../schemas/projectInvitations.js';
import {
  createInvitation,
  listPendingInvitations,
  revokeInvitation,
} from '../../services/projectInvitations.js';

/**
 * `/projects/:projectId/invitations` の各エンドポイント (§3.4b)。
 * `requireAuth()` + `attachCurrentUserId()` は親 projectsRoute で適用済み。
 *
 * 招待の作成・取り消しは管理者のみ (member.invite)。未受諾の招待は座席を
 * 消費するため、一覧も管理者に限定する。
 */
export const projectInvitationsRoute = new Hono()
  .get('/', requireProjectMember(), requireProjectAction('member.invite'), async (c) => {
    const project = c.get('project');
    const invitations = await listPendingInvitations(project.projectId);
    return c.json({ data: invitations });
  })

  .post('/', requireProjectMember(), requireProjectAction('member.invite'), async (c) => {
    const project = c.get('project');
    const body = createInvitationBodySchema.parse(await c.req.json());
    const result = await createInvitation({
      projectId: project.projectId,
      organizationId: project.organizationId,
      actorUserId: c.get('currentUserId'),
      origin: resolveRequestOrigin(c),
      body,
    });
    return c.json(
      { data: result.invitation, ...(result.warnings ? { warnings: result.warnings } : {}) },
      201,
    );
  })

  .delete(
    '/:invitationId',
    requireProjectMember(),
    requireProjectAction('member.invite'),
    async (c) => {
      const project = c.get('project');
      const invitationId = c.req.param('invitationId');
      if (!invitationId) throw new ApiException('BAD_REQUEST', 400, 'invitationId required.');
      await revokeInvitation({
        projectId: project.projectId,
        invitationId,
        actorUserId: c.get('currentUserId'),
      });
      return c.body(null, 204);
    },
  );
