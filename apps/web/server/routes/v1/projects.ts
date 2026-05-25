import { Hono } from 'hono';

import { requireAuth } from '../../middleware/auth.js';
import {
  attachCurrentUserId,
  requireProjectDirector,
  requireProjectMember,
} from '../../middleware/projectAuth.js';
import {
  createItemBodySchema,
  createProjectBodySchema,
  listProjectsQuerySchema,
  updateItemBodySchema,
  updateProjectBodySchema,
} from '../../schemas/projects.js';
import {
  createProject,
  getProjectDetail,
  listProjects,
  updateProject,
} from '../../services/projects.js';
import {
  createItem,
  deleteItem,
  getItem,
  listItems,
  updateItem,
} from '../../services/items.js';
import { ApiException } from '../../lib/errors.js';
import { membersRoute } from './members.js';
import { plansRoute } from './plans.js';

export const projectsRoute = new Hono()
  .use('*', requireAuth())
  .use('*', attachCurrentUserId())

  // ----------------------------- /projects -----------------------------
  .get('/', async (c) => {
    const userId = c.get('currentUserId');
    const q = listProjectsQuerySchema.parse({
      status: c.req.query('status'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });
    const { items, total } = await listProjects(userId, q);
    return c.json({ data: items, meta: { total, limit: q.limit, offset: q.offset } });
  })

  .post('/', async (c) => {
    const userId = c.get('currentUserId');
    const body = createProjectBodySchema.parse(await c.req.json());
    const project = await createProject({ body, currentUserId: userId });
    return c.json({ data: project }, 201);
  })

  // ----------------------------- /projects/:projectId -----------------------------
  .get('/:projectId', requireProjectMember(), async (c) => {
    const userId = c.get('currentUserId');
    const project = c.get('project');
    const detail = await getProjectDetail(project.projectId, userId);
    return c.json({ data: detail });
  })

  .patch('/:projectId', requireProjectMember(), requireProjectDirector(), async (c) => {
    const userId = c.get('currentUserId');
    const project = c.get('project');
    const body = updateProjectBodySchema.parse(await c.req.json());
    const result = await updateProject({
      projectId: project.projectId,
      body,
      currentUserId: userId,
    });
    return c.json({ data: result.project, warnings: result.warnings });
  })

  // ----------------------------- /projects/:projectId/items -----------------------------
  .get('/:projectId/items', requireProjectMember(), async (c) => {
    const project = c.get('project');
    const items = await listItems(project.projectId);
    return c.json({ data: items });
  })

  .post(
    '/:projectId/items',
    requireProjectMember(),
    requireProjectDirector(),
    async (c) => {
      const project = c.get('project');
      const body = createItemBodySchema.parse(await c.req.json());
      const item = await createItem({ projectId: project.projectId, body });
      return c.json({ data: item }, 201);
    },
  )

  .get('/:projectId/items/:itemId', requireProjectMember(), async (c) => {
    const project = c.get('project');
    const itemId = c.req.param('itemId');
    if (!itemId) throw new ApiException('BAD_REQUEST', 400, 'itemId required');
    const item = await getItem(itemId, project.projectId);
    return c.json({ data: item });
  })

  .patch(
    '/:projectId/items/:itemId',
    requireProjectMember(),
    requireProjectDirector(),
    async (c) => {
      const project = c.get('project');
      const itemId = c.req.param('itemId');
      if (!itemId) throw new ApiException('BAD_REQUEST', 400, 'itemId required');
      const body = updateItemBodySchema.parse(await c.req.json());
      const item = await updateItem({ itemId, projectId: project.projectId, body });
      return c.json({ data: item });
    },
  )

  .delete(
    '/:projectId/items/:itemId',
    requireProjectMember(),
    requireProjectDirector(),
    async (c) => {
      const project = c.get('project');
      const itemId = c.req.param('itemId');
      if (!itemId) throw new ApiException('BAD_REQUEST', 400, 'itemId required');
      await deleteItem({ itemId, projectId: project.projectId });
      return c.body(null, 204);
    },
  )

  // ----------------------------- /projects/:projectId/members -----------------------------
  .route('/:projectId/members', membersRoute)

  // ----------------------------- /projects/:projectId/items/:itemId/plans -----------------------------
  .route('/:projectId/items/:itemId/plans', plansRoute);
