import type { Context, MiddlewareHandler } from 'hono';

import { prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';

export type ProjectMembership = {
  projectId: string;
  memberId: string;
  isDirector: boolean;
  memberType: 'client' | 'production';
};

declare module 'hono' {
  interface ContextVariableMap {
    project: ProjectMembership;
    currentUserId: string;
  }
}

/**
 * `c.var.authUser.authUserId` から `users.id` を解決して `c.var.currentUserId` にセットする。
 * `requireAuth()` の後段で使う薄いヘルパー。
 */
export function attachCurrentUserId(): MiddlewareHandler {
  return async (c, next) => {
    const authUser = c.get('authUser');
    const user = await prisma.user.findUnique({
      where: { authUserId: authUser.authUserId },
      select: { id: true, deletedAt: true },
    });
    // 退会済み (deletedAt) は未存在として扱う (締め出し)。
    if (!user || user.deletedAt) {
      throw new ApiException(
        'PROFILE_NOT_COMPLETED',
        404,
        'Profile is not yet completed. Call /auth/me/sync first.',
      );
    }
    c.set('currentUserId', user.id);
    await next();
  };
}

/**
 * `:projectId` パラメータのプロジェクトに参加しているか判定し、
 * 未参加 / 未存在を **404 集約**で返す。
 * 成功時 `c.var.project` に { projectId, memberId, isDirector, memberType } をセット。
 *
 * 設計書 §3.3 認可ミドルウェアの階層チェーン
 */
export function requireProjectMember(): MiddlewareHandler {
  return async (c, next) => {
    const projectId = c.req.param('projectId');
    if (!projectId) {
      throw new ApiException('BAD_REQUEST', 400, 'projectId param missing.');
    }
    const userId = c.get('currentUserId');

    const [project, member] = await Promise.all([
      prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { id: true, createdBy: true },
      }),
      prisma.projectMember.findFirst({
        where: {
          projectId,
          userId,
          deletedAt: null,
        },
        select: { id: true, memberType: true },
      }),
    ]);

    // 404 に集約: 未存在 / 未参加 を区別しない
    if (!project || !member) {
      throw notFound(c);
    }

    c.set('project', {
      projectId: project.id,
      memberId: member.id,
      isDirector: project.createdBy === userId,
      memberType: member.memberType as ProjectMembership['memberType'],
    });
    await next();
  };
}

/**
 * `requireProjectMember()` の後段で使う。ディレクター以外を 404 に集約する。
 */
export function requireProjectDirector(): MiddlewareHandler {
  return async (c, next) => {
    const project = c.get('project');
    if (!project.isDirector) {
      throw notFound(c);
    }
    await next();
  };
}

function notFound(c: Context) {
  return new ApiException(
    'NOT_FOUND',
    404,
    `Resource not found: ${c.req.method} ${c.req.path}`,
  );
}
