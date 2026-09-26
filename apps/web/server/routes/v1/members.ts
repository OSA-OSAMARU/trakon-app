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
  listMemberCandidates,
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

  /**
   * 参加者に追加できる組織メンバーの候補 (#238)。
   *
   * 組織は**このプロジェクトのもの**を使う。既定組織 (`/organizations/me/members`)
   * を使うと、別組織に招かれている利用者の画面で候補が空になったり、
   * 追加できない人が並んだりする。
   */
  .get('/candidates', requireProjectMember(), requireProjectAction('member.create'), async (c) => {
    const project = c.get('project');
    return c.json({
      data: await listMemberCandidates({
        organizationId: project.organizationId,
        projectId: project.projectId,
      }),
    });
  })

  .post('/', requireProjectMember(), requireProjectWritable(), requireProjectAction('member.create'), async (c) => {
    const project = c.get('project');
    const body = addMembersBodySchema.parse(await c.req.json());
    const created = await addMembers({
      projectId: project.projectId,
      organizationId: project.organizationId,
      body,
    });
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
      const member = await updateMember({
        memberId,
        projectId: project.projectId,
        organizationId: project.organizationId,
        body,
      });
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
