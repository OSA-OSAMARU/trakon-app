import type { Context, MiddlewareHandler } from 'hono';

import { prisma } from '@trakon/db';
import { canManageBilling, type OrgRole } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import { resolvePrimaryOrganization } from '../services/organizations.js';

export type OrganizationContext = {
  organizationId: string;
  orgRole: OrgRole;
};

declare module 'hono' {
  interface ContextVariableMap {
    organization: OrganizationContext;
  }
}

/**
 * 既定の所属組織を解決して `c.var.organization` にセットする (設計書 §3.3.3)。
 * `requireAuth()` + `attachCurrentUserId()` の後段で使う。
 */
export function requireOrgMember(): MiddlewareHandler {
  return async (c, next) => {
    const userId = c.get('currentUserId');
    const membership = await resolvePrimaryOrganization(prisma, userId);
    c.set('organization', membership);
    await next();
  };
}

/**
 * 課金操作 (プラン契約・変更・解約・支払方法変更・組織メンバー管理) を
 * 組織のオーナー / 管理者に限定する (PRD SR-AUTHZ-06)。
 *
 * プロジェクトロールとは別系統なので、同じ判定関数に混ぜない。
 */
export function requireOrgBillingRole(): MiddlewareHandler {
  return async (c, next) => {
    const organization = c.get('organization');
    if (!canManageBilling(organization.orgRole)) {
      throw forbidden(c);
    }
    await next();
  };
}

function forbidden(c: Context) {
  return new ApiException(
    'FORBIDDEN',
    403,
    'この操作は組織のオーナーまたは管理者のみが実行できます。',
    { path: c.req.path },
  );
}
