import type { Context, MiddlewareHandler } from 'hono';

import { prisma } from '@trakon/db';
import { canProjectRole, type ProjectAction, type ProjectRole } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';

export type ProjectMembership = {
  projectId: string;
  /** 所属組織。プラン上限・課金判定の単位 (設計書 §7.3.1) */
  organizationId: string;
  memberId: string;
  /** 権限ロール。操作権限の唯一の根拠 (設計書 §5.4.2) */
  role: ProjectRole;
  memberType: 'client' | 'production' | 'partner';
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
    // 退会済み (deletedAt) は未存在として扱い、ready を返さない (締め出し)。
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
 * 成功時 `c.var.project` に { projectId, organizationId, memberId, role, memberType } をセット。
 *
 * 設計書 §3.3 認可ミドルウェアの階層チェーン / §5.4.2 ロールの解決
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
        select: { id: true, organizationId: true, createdBy: true },
      }),
      prisma.projectMember.findFirst({
        where: {
          projectId,
          userId,
          deletedAt: null,
        },
        select: { id: true, memberType: true, roleType: true },
      }),
    ]);

    // 404 に集約: 未存在 / 未参加 を区別しない
    if (!project || !member) {
      throw notFound(c);
    }

    // プロジェクト作成者は role_type の値によらず常に管理者として扱う。
    // 自分のプロジェクトから締め出されることを防ぐ最終防衛線 (PRD FR-ROLE-04)。
    const role: ProjectRole =
      project.createdBy === userId ? 'admin' : (member.roleType as ProjectRole);

    c.set('project', {
      projectId: project.id,
      organizationId: project.organizationId,
      memberId: member.id,
      role,
      memberType: member.memberType as ProjectMembership['memberType'],
    });
    await next();
  };
}

/**
 * `requireProjectMember()` の後段で使う。ロールがその操作を許可していなければ
 * **404 に集約**する (参加していることは判明済みだが、認可失敗は 404 に寄せる既存方針)。
 *
 * ロール別の可否は `packages/shared` のロール別操作マトリクス 1 箇所が持つ。
 * 方針を変えるときはそちらを書き換える (設計書 §7.12.2)。
 */
export function requireProjectAction(action: ProjectAction): MiddlewareHandler {
  return async (c, next) => {
    const project = c.get('project');
    if (!canProjectRole(project.role, action)) {
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
