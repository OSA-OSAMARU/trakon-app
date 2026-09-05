import { Hono } from 'hono';

import {
  requireProjectAction,
  requireProjectWritable,
  requireProjectMember,
} from '../../middleware/projectAuth.js';
import { requireItemInProject } from '../../middleware/itemAuth.js';
import { ApiException } from '../../lib/errors.js';
import {
  createPlanBodySchema,
  listPlansQuerySchema,
  sendBackBodySchema,
  setSuccessorBodySchema,
  updatePlanBodySchema,
} from '../../schemas/plans.js';
import {
  createPlan,
  deletePlan,
  duplicatePlan,
  getPlan,
  listPlans,
  setPlanSuccessor,
  updatePlan,
} from '../../services/plans.js';
import {
  approvePlan,
  completePlan,
  requestReviewPlan,
  sendBackPlan,
  sendBackToPredecessorPlan,
  tossPlan,
  undoApprovePlan,
  undoCompletePlan,
  undoRequestReviewPlan,
  undoTossPlan,
} from '../../services/ballActions.js';

/**
 * `/projects/:projectId/items/:itemId/plans` 配下のエンドポイント。
 * 親 projectsRoute で requireAuth + attachCurrentUserId が適用済み。
 *
 *  - GET    /                       一覧
 *  - POST   /                       作成
 *  - POST   /:planId/copy           複製 (#51)
 *  - GET    /:planId                詳細 (events 含む)
 *  - PATCH  /:planId                更新 (itemId 指定で別制作物へ移動 #52)
 *  - DELETE /:planId                削除 (ball_events なしのみ)
 *  - PATCH  /:planId/successor           後続紐付け
 *  - POST   /:planId/request-review      確認依頼 (実施中 → 確認待ち) #131
 *  - POST   /:planId/request-review-undo 確認依頼の取り消し
 *  - POST   /:planId/approve             承認 (→ 承認済み) #131
 *  - POST   /:planId/approve-undo        承認の取り消し
 *  - POST   /:planId/send-back           差し戻し (承認者 → 実施者) #131
 *  - POST   /:planId/send-back-to-predecessor 前工程へ差し戻し (先行予定を再開) #131 §13
 *  - POST   /:planId/toss                TOSS 実行 (進行責任者 → 後続実施者)
 *  - POST   /:planId/toss-undo           TOSS の取り消し
 *  - POST   /:planId/complete            完了 (= approve のエイリアス, 後方互換)
 *  - POST   /:planId/complete-undo       完了の取り消し (= approve-undo)
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

  .post('/', requireProjectWritable(), requireProjectAction('plan.create'), async (c) => {
    const itemId = c.get('itemId');
    const project = c.get('project');
    const body = createPlanBodySchema.parse(await c.req.json());
    const plan = await createPlan({ itemId, projectId: project.projectId, body });
    return c.json({ data: plan }, 201);
  })

  .post('/:planId/copy', requireProjectWritable(), requireProjectAction('plan.create'), async (c) => {
    const itemId = c.get('itemId');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const plan = await duplicatePlan({ itemId, planId });
    return c.json({ data: plan }, 201);
  })

  .get('/:planId', async (c) => {
    const itemId = c.get('itemId');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const detail = await getPlan({ itemId, planId });
    return c.json({ data: detail });
  })

  .patch('/:planId', requireProjectWritable(), requireProjectAction('plan.update'), async (c) => {
    const itemId = c.get('itemId');
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const body = updatePlanBodySchema.parse(await c.req.json());
    const plan = await updatePlan({ itemId, planId, projectId: project.projectId, body });
    return c.json({ data: plan });
  })

  .delete('/:planId', requireProjectWritable(), requireProjectAction('plan.delete'), async (c) => {
    const itemId = c.get('itemId');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    await deletePlan({ itemId, planId });
    return c.body(null, 204);
  })

  .patch('/:planId/successor', requireProjectWritable(), requireProjectAction('plan.update'), async (c) => {
    const itemId = c.get('itemId');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const body = setSuccessorBodySchema.parse(await c.req.json());
    const plan = await setPlanSuccessor({ itemId, planId, body });
    return c.json({ data: plan });
  })

  .post('/:planId/request-review', requireProjectWritable(), async (c) => {
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const result = await requestReviewPlan({
      itemId: c.get('itemId'),
      planId,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      role: project.role,
    });
    return c.json({ data: result });
  })

  .post('/:planId/request-review-undo', requireProjectWritable(), async (c) => {
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const result = await undoRequestReviewPlan({
      itemId: c.get('itemId'),
      planId,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      role: project.role,
    });
    return c.json({ data: result });
  })

  .post('/:planId/approve', requireProjectWritable(), async (c) => {
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const result = await approvePlan({
      itemId: c.get('itemId'),
      planId,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      role: project.role,
    });
    return c.json({ data: result });
  })

  .post('/:planId/approve-undo', requireProjectWritable(), async (c) => {
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const result = await undoApprovePlan({
      itemId: c.get('itemId'),
      planId,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      role: project.role,
    });
    return c.json({ data: result });
  })

  .post('/:planId/send-back', requireProjectWritable(), async (c) => {
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const body = sendBackBodySchema.parse(await c.req.json().catch(() => ({})));
    const result = await sendBackPlan({
      itemId: c.get('itemId'),
      planId,
      note: body?.note ?? null,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      role: project.role,
    });
    return c.json({ data: result });
  })

  .post('/:planId/send-back-to-predecessor', requireProjectWritable(), async (c) => {
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const body = sendBackBodySchema.parse(await c.req.json().catch(() => ({})));
    const result = await sendBackToPredecessorPlan({
      itemId: c.get('itemId'),
      planId,
      note: body?.note ?? null,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      role: project.role,
    });
    return c.json({ data: result });
  })

  .post('/:planId/toss', requireProjectWritable(), async (c) => {
    const itemId = c.get('itemId');
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const result = await tossPlan({
      itemId,
      projectId: project.projectId,
      planId,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      role: project.role,
    });
    return c.json({ data: result });
  })

  .post('/:planId/toss-undo', requireProjectWritable(), async (c) => {
    const itemId = c.get('itemId');
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const result = await undoTossPlan({
      itemId,
      projectId: project.projectId,
      planId,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      role: project.role,
    });
    return c.json({ data: result });
  })

  .post('/:planId/complete', requireProjectWritable(), async (c) => {
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
      role: project.role,
    });
    return c.json({ data: result });
  })

  .post('/:planId/complete-undo', requireProjectWritable(), async (c) => {
    const itemId = c.get('itemId');
    const project = c.get('project');
    const planId = c.req.param('planId');
    if (!planId) throw new ApiException('BAD_REQUEST', 400, 'planId required');
    const result = await undoCompletePlan({
      itemId,
      projectId: project.projectId,
      planId,
      currentUserId: c.get('currentUserId'),
      currentMemberId: project.memberId,
      role: project.role,
    });
    return c.json({ data: result });
  });
