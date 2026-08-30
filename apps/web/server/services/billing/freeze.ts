// -----------------------------------------------------------------------------
// プロジェクトの凍結 — 設計書 §7.11
//
// 【確定要件】上限を超えたプロジェクトは削除せず「新規編集不可・閲覧のみ」に
// する。どれを維持するかはユーザーが選べる。
//
// 凍結状態は DB に永続化せず**都度計算する**。プラン変更・Webhook の遅延・
// アーカイブ操作と自動的に整合し、定期バッチも不要になる。
// この設計の結果として、超過分を削除するコードがそもそも存在しない。
// -----------------------------------------------------------------------------
import { prisma } from '@trakon/db';
import { selectFrozenProjectIds } from '@trakon/shared';

import { ApiException } from '../../lib/errors.js';
import { getEntitlement } from './entitlement.js';

/** 凍結されているプロジェクト ID を求める。 */
export async function getFrozenProjectIds(organizationId: string): Promise<string[]> {
  const [entitlement, projects] = await Promise.all([
    getEntitlement(prisma, organizationId),
    prisma.project.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, createdAt: true, archivedAt: true, retainedAt: true },
    }),
  ]);
  return selectFrozenProjectIds(projects, entitlement.limits.projectLimit).frozenIds;
}

export async function isProjectFrozen(
  organizationId: string,
  projectId: string,
): Promise<boolean> {
  return (await getFrozenProjectIds(organizationId)).includes(projectId);
}

/**
 * 維持するプロジェクトを選び直す (FR-BILL-11)。
 *
 * 指定された順に retained_at を採番し、それ以外はクリアする。
 * 上限を超える件数を指定された場合は受け付けない。
 */
export async function setRetainedProjects(input: {
  organizationId: string;
  projectIds: string[];
  actorUserId: string;
}): Promise<{ retainedIds: string[]; frozenIds: string[] }> {
  const entitlement = await getEntitlement(prisma, input.organizationId);
  const limit = entitlement.limits.projectLimit;

  if (limit !== null && input.projectIds.length > limit) {
    throw new ApiException(
      'PROJECT_LIMIT_REACHED',
      409,
      `維持できるプロジェクトは ${limit} 件までです。`,
      { limit, requested: input.projectIds.length },
    );
  }

  const owned = await prisma.project.findMany({
    where: { organizationId: input.organizationId, deletedAt: null },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((p) => p.id));
  const unknown = input.projectIds.filter((id) => !ownedIds.has(id));
  if (unknown.length > 0) {
    throw new ApiException('NOT_FOUND', 404, 'Project not found.', { projectIds: unknown });
  }

  const now = Date.now();
  await prisma.$transaction([
    // 一度すべてクリアしてから、指定順に採番し直す
    prisma.project.updateMany({
      where: { organizationId: input.organizationId },
      data: { retainedAt: null },
    }),
    ...input.projectIds.map((id, index) =>
      // 「維持指定が新しい順」に並ぶよう、先頭ほど新しい時刻にする
      prisma.project.update({
        where: { id },
        data: { retainedAt: new Date(now + (input.projectIds.length - index)) },
      }),
    ),
    prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'retained_projects_changed',
        resourceType: 'organization',
        resourceId: input.organizationId,
        result: 'success',
        extra: { projectIds: input.projectIds },
      },
    }),
  ]);

  const frozenIds = await getFrozenProjectIds(input.organizationId);
  return { retainedIds: input.projectIds, frozenIds };
}
