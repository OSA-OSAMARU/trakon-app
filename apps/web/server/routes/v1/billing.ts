import { Hono } from 'hono';

import { requireAuth } from '../../middleware/auth.js';
import { requireOrgBillingRole, requireOrgMember } from '../../middleware/orgAuth.js';
import { attachCurrentUserId } from '../../middleware/projectAuth.js';
import { resolveRequestOrigin } from '../../lib/requestOrigin.js';
import {
  changePlanBodySchema,
  createCheckoutSessionBodySchema,
} from '../../schemas/billing.js';
import { createCheckoutSession, createPortalSession } from '../../services/billing/checkout.js';
import { getOrganizationBilling } from '../../services/billing/entitlement.js';
import {
  cancelSubscription,
  changePlan,
  resumeSubscription,
} from '../../services/billing/planChange.js';

/**
 * `/api/v1/billing` — 設計書 §3.4b / 章7
 *
 * 契約状態の閲覧は組織メンバー全員、変更操作はオーナー / 管理者のみ。
 */
export const billingRoute = new Hono()
  .use('*', requireAuth())
  .use('*', attachCurrentUserId())
  .use('*', requireOrgMember())

  .get('/subscription', async (c) => {
    const { organizationId } = c.get('organization');
    const data = await getOrganizationBilling(organizationId);
    return c.json({ data: { ...data, orgRole: c.get('organization').orgRole } });
  })

  .post('/checkout-session', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    const body = createCheckoutSessionBodySchema.parse(await c.req.json());
    const result = await createCheckoutSession({
      organizationId,
      userId: c.get('currentUserId'),
      planCode: body.planCode,
      origin: resolveRequestOrigin(c),
    });
    return c.json({ data: result });
  })

  .post('/portal-session', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    const result = await createPortalSession({
      organizationId,
      origin: resolveRequestOrigin(c),
    });
    return c.json({ data: result });
  })

  .post('/plan', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    const body = changePlanBodySchema.parse(await c.req.json());
    const result = await changePlan({
      organizationId,
      actorUserId: c.get('currentUserId'),
      planCode: body.planCode,
    });
    return c.json({ data: result });
  })

  .post('/cancel', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    const result = await cancelSubscription({
      organizationId,
      actorUserId: c.get('currentUserId'),
    });
    return c.json({ data: result });
  })

  .post('/resume', requireOrgBillingRole(), async (c) => {
    const { organizationId } = c.get('organization');
    const result = await resumeSubscription({
      organizationId,
      actorUserId: c.get('currentUserId'),
    });
    return c.json({ data: result });
  });
