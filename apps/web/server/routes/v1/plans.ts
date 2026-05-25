import { Hono } from 'hono';

import {
  requireProjectDirector,
  requireProjectMember,
} from '../../middleware/projectAuth.js';
import { requireItemInProject } from '../../middleware/itemAuth.js';
import { ApiException } from '../../lib/errors.js';
import {
  createPlanBodySchema,
  listPlansQuerySchema,
  setSuccessorBodySchema,
  tossBodySchema,
  updatePlanBodySchema,
} from '../../schemas/plans.js';
import {
  createPlan,
  deletePlan,
  getPlan,
  listPlans,
  setPlanSuccessor,
  updatePlan,
} from '../../services/plans.js';
import { completePlan, tossPlan } from '../../services/ballActions.js';

/**
 * `/projects/:projectId/items/:itemId/plans` 配下のエンドポイント。
 * 親 projectsRoute で requireAuth + attachCurrentUserId が適用済み。
 *
 * 全 8 本:
 *  - GET    /                       一覧
 *  - POST   /                       作成
 *  - GET    /:planId                詳細 (events 含む)
 *  - PATCH  /:planId                更新
 *  - DELETE /:planId                削除 (ball_events なしのみ)
 *  - PATCH  /:planId/successor      後続紐付け
 *  - POST   /:planId/toss           TOSS 実行
 *  - POST   /:planId/complete       完了
 */
export const plansRoute = new Hono()
  .use('*', requireProjectMember())
  .use('*', requireItemInProject())

  .get('/', async (c) => {
    const itemId = c.get('itemId');
    const query = listPlansQuerySchema.parse({
      from: c.req.query('from'),
      to: c.req.query('to'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });
    const { items, total } = await listPlans({ itemId, query });
    return c.json({
      data: items,
      meta: { total, limit: query.limit, offset: query.offset },
    });
  })

  .post('/', async (c) => {
    const itemId = c.get('itemId');
    const project = c.get('project');
    const body = createPlanBodySchema.parse(await c.req.json());
    const plan = await createPlan({ itemId, projectId: project.projectId, body });
    return c.json({ data: plan }, 201);
  })

  .get('/:planId', async (c) => {
    const itemId = c.get('itemId');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const detail = await getPlan({ itemId, planId });
    return c.json({ data: detail });
  })

  .patch('/:planId', async (c) => {
    const itemId = c.get('itemId');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const body = updatePlanBodySchema.parse(await c.req.json());
    const plan = await updatePlan({ itemId, planId, body });
    return c.json({ data: plan });
  })

  .delete('/:planId', requireProjectDirector(), async (c) => {
    const itemId = c.get('itemId');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    await deletePlan({ itemId, planId });
    return c.body(null, 204);
  })

  .patch('/:planId/successor', async (c) => {
    const itemId = c.get('itemId');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const body = setSuccessorBodySchema.parse(await c.req.json());
    const plan = await setPlanSuccessor({ itemId, planId, body });
    return c.json({ data: plan });
  })

  .post('/:planId/toss', async (c) => {
    const itemId = c.get('itemId');
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const body = tossBodySchema.parse(await c.req.json().catch(() => ({})));
    const result = await tossPlan({
      itemId,
      projectId: project.projectId,
      planId,
      body,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      isDirector: project.isDirector,
    });
    return c.json({ data: result });
  })

  .post('/:planId/complete', async (c) => {
    const itemId = c.get('itemId');
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const result = await completePlan({
      itemId,
      projectId: project.projectId,
      planId,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      isDirector: project.isDirector,
    });
    return c.json({ data: result });
  });
