import type { MiddlewareHandler } from 'hono';

import { prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';

declare module 'hono' {
  interface ContextVariableMap {
    itemId: string;
  }
}

/**
 * `:itemId` パスパラメータが `:projectId` に属するか検証する。
 * `requireProjectMember()` の後段で使う。
 * 未存在 / 別プロジェクトのものを 404 集約。
 */
export function requireItemInProject(): MiddlewareHandler {
  return async (c, next) => {
    const itemId = c.req.param('itemId');
    if (!itemId) throw new ApiException('BAD_REQUEST', 400, 'itemId param missing.');

    const project = c.get('project');
    const item = await prisma.projectItem.findFirst({
      where: { id: itemId, projectId: project.projectId, deletedAt: null },
      select: { id: true },
    });
    if (!item) {
      throw new ApiException('NOT_FOUND', 404, `Item not found: ${itemId}`);
    }
    c.set('itemId', item.id);
    await next();
  };
}
