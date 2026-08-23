import { deriveLineBallHolders } from '@trakon/shared';

import type { MemberRef, Plan } from '../api';

/**
 * source の後続として target を設定できるか (BE assertSuccessorAvailable のミラー)。
 * 同一制作物・自己参照禁止・active・他から後続参照されていない・直接循環なし。
 */
export function isValidLinkTarget(source: Plan, target: Plan, itemPlans: Plan[]): boolean {
  if (target.id === source.id) return false;
  if (target.itemId !== source.itemId) return false;
  if (target.status !== 'active') return false;
  if (itemPlans.some((p) => p.id !== source.id && p.successorPlanId === target.id)) return false;
  // target のチェーンが source へ戻る場合は循環になるので不可
  const byId = new Map(itemPlans.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let cur: Plan | undefined = target;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.id === source.id) return false;
    cur = cur.successorPlanId ? byId.get(cur.successorPlanId) : undefined;
  }
  return true;
}

/**
 * planId が属する後続チェーン (前後双方向にたどった全 plan) と、
 * その内部リンク (チェーン内の先行→後続) の source id 集合を返す。
 * ホバー時のチェーン強調に使う。
 */
export function computeChain(
  itemPlans: Plan[],
  planId: string,
): { chainIds: Set<string>; linkSourceIds: Set<string> } {
  const byId = new Map(itemPlans.map((p) => [p.id, p]));
  const predOf = new Map<string, string>(); // successorId -> predecessorId
  for (const p of itemPlans) {
    if (p.successorPlanId) predOf.set(p.successorPlanId, p.id);
  }
  const chainIds = new Set<string>();
  // 後続方向
  let cur: Plan | undefined = byId.get(planId);
  while (cur && !chainIds.has(cur.id)) {
    chainIds.add(cur.id);
    cur = cur.successorPlanId ? byId.get(cur.successorPlanId) : undefined;
  }
  // 先行方向
  let prevId = predOf.get(planId);
  while (prevId && !chainIds.has(prevId)) {
    chainIds.add(prevId);
    prevId = predOf.get(prevId);
  }
  // チェーン内リンク (両端がチェーンに含まれる先行 plan)
  const linkSourceIds = new Set<string>();
  for (const id of chainIds) {
    const succ = byId.get(id)?.successorPlanId;
    if (succ && chainIds.has(succ)) linkSourceIds.add(id);
  }
  return { chainIds, linkSourceIds };
}

/**
 * ライン単位の現在のボール保持者 (member) を解決する (#117)。
 * deriveLineBallHolders が返す member_id を、予定に紐づく MemberRef へ解決する。
 */
export function resolveHolders(itemPlans: Plan[]): MemberRef[] {
  const holderIds = deriveLineBallHolders(
    itemPlans.map((p) => ({
      id: p.id,
      successorPlanId: p.successorPlanId,
      status: p.status,
      ballState: p.ballState,
      executorMemberId: p.executor?.id ?? null,
      approverMemberId: p.approver?.id ?? null,
      progressManagerMemberId: p.progressManager?.id ?? null,
      toMemberId: p.toMember?.id ?? null,
    })),
  );
  const refById = new Map<string, MemberRef>();
  for (const p of itemPlans) {
    for (const m of [p.executor, p.approver, p.progressManager, p.fromMember, p.toMember]) {
      if (m) refById.set(m.id, m);
    }
  }
  return holderIds.map((id) => refById.get(id)).filter((m): m is MemberRef => m !== undefined);
}
