import { Hono } from 'hono';

import { ApiException } from '../../lib/errors.js';
import {
  requireProjectAction,
  requireProjectWritable,
  requireProjectMember,
} from '../../middleware/projectAuth.js';
import { resolveRequestOrigin } from '../../lib/requestOrigin.js';
import { createShareLinkBodySchema } from '../../schemas/shareLinks.js';
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
} from '../../services/shareLinks.js';

/**
 * `/projects/:projectId/share-links` の各エンドポイント。
 * 親 projectsRoute で requireAuth + attachCurrentUserId が適用済み。
 * 認可: 一覧はメンバー、発行と revoke はディレクターのみ。
 */
export const shareLinksRoute = new Hono()
  .get('/', requireProjectMember(), async (c) => {
    const project = c.get('project');
    const items = await listShareLinks(project.projectId);
    return c.json({ data: items });
  })

  .post(
    '/',
    requireProjectMember(),
    requireProjectWritable(),
    requireProjectAction('share_link.create'),
    async (c) => {
      const project = c.get('project');
      const body = createShareLinkBodySchema.parse(await c.req.json());
      const result = await createShareLink({
        projectId: project.projectId,
        issuerMemberId: project.memberId,
        body,
        baseUrl: resolveRequestOrigin(c),
      });
      return c.json({ data: result }, 201);
    },
  )

  .delete(
    '/:shareLinkId',
    requireProjectMember(),
    requireProjectWritable(),
    requireProjectAction('share_link.revoke'),
    async (c) => {
      const project = c.get('project');
      const userId = c.get('currentUserId');
      const shareLinkId = c.req.param('shareLinkId');
      if (!shareLinkId) throw new ApiException('BAD_REQUEST', 400, 'shareLinkId required');
      await revokeShareLink({
        projectId: project.projectId,
        shareLinkId,
        actorUserId: userId,
      });
      return c.body(null, 204);
    },
  );
