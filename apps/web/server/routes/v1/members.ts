import { Hono } from 'hono';

import {
  requireProjectAction,
  requireProjectWritable,
  requireProjectMember,
} from '../../middleware/projectAuth.js';
import { ApiException } from '../../lib/errors.js';
import {
  addMembersBodySchema,
  reorderMembersBodySchema,
  updateMemberBodySchema,
} from '../../schemas/members.js';
import {
  addMembers,
  deleteMember,
  listMembers,
  reorderMembers,
  updateMember,
} from '../../services/members.js';

/**
 * `/projects/:projectId/members` の各エンドポイント。
 * `requireAuth()` + `attachCurrentUserId()` は親 projectsRoute で適用済み。
 * 認可は requireProjectMember / requireProjectAction を個別に付与する。
 */
export const membersRoute = new Hono()
  .get('/', requireProjectMember(), async (c) => {
    const project = c.get('project');
    const members = await listMembers(project.projectId);
    return c.json({ data: members });
  })

  .post('/', requireProjectMember(), requireProjectWritable(), requireProjectAction('member.create'), async (c) => {
    const project = c.get('project');
    const body = addMembersBodySchema.parse(await c.req.json());
    const created = await addMembers({ projectId: project.projectId, body });
    return c.json({ data: created }, 201);
  })

  // 並び替え (#111)。静的セグメント /reorder は :memberId より優先される。
  .post('/reorder', requireProjectMember(), requireProjectWritable(), requireProjectAction('member.update'), async (c) => {
    const project = c.get('project');
    const body = reorderMembersBodySchema.parse(await c.req.json());
    const members = await reorderMembers({
      projectId: project.projectId,
      orderedIds: body.orderedIds,
    });
    return c.json({ data: members });
  })

  .patch(
    '/:memberId',
    requireProjectMember(),
    requireProjectWritable(),
    requireProjectAction('member.update'),
    async (c) => {
      const project = c.get('project');
      const memberId = c.req.param('memberId');
      if (!memberId) throw new ApiException('BAD_REQUEST', 400, 'memberId required.');
      const body = updateMemberBodySchema.parse(await c.req.json());
      const member = await updateMember({ memberId, projectId: project.projectId, body });
      return c.json({ data: member });
    },
  )

  .delete(
    '/:memberId',
    requireProjectMember(),
    requireProjectWritable(),
    requireProjectAction('member.remove'),
    async (c) => {
      const project = c.get('project');
      const userId = c.get('currentUserId');
      const memberId = c.req.param('memberId');
      if (!memberId) throw new ApiException('BAD_REQUEST', 400, 'memberId required.');
      await deleteMember({
        memberId,
        projectId: project.projectId,
        currentUserId: userId,
      });
      return c.body(null, 204);
    },
  );
