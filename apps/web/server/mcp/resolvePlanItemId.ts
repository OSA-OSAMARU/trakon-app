import { prisma } from '@trakon/db';

/**
 * planId から itemId を引く (MCP ツールが REST のパスを組み立てるため)。
 * **projectId 配下に限定**し、削除済みは対象外。参加の有無はここでは見ない —
 * 続く REST 呼び出しが requireProjectMember() で 404 に集約する (設計書 08-mcp §8.7.2)。
 */
export async function resolvePlanItemId(projectId: string, planId: string): Promise<string | null> {
  const plan = await prisma.plan.findFirst({
    where: { id: planId, deletedAt: null, item: { projectId, deletedAt: null } },
    select: { itemId: true },
  });
  return plan?.itemId ?? null;
}
