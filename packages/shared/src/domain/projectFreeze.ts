/**
 * プロジェクト凍結の判定 (FE/BE 共通)
 * 設計書 §7.11 / PRD §4.1.12b (FR-BILL-11)
 *
 * 【確定要件】プラン上限を超えたプロジェクトは **削除せず**、
 * 「新規編集不可・閲覧のみ」で凍結する。ユーザーがどれを維持するか選べるまで保持する。
 *
 * 凍結状態は DB に永続化せず **都度計算する**:
 *   - プラン変更・Webhook の遅延・アーカイブ操作と自動的に整合する
 *   - フラグを更新するための定期バッチが不要になる
 *   - 「凍結フラグは立っているが実は上限内」という不整合が原理的に発生しない
 */

export type FreezableProject = {
  id: string;
  createdAt: string | Date;
  /** アーカイブ済みはカウント対象外 (= 枠を空ける正規の動線) */
  archivedAt: string | Date | null;
  /** ユーザーが「維持する」と選択した日時 (projects.retained_at) */
  retainedAt: string | Date | null;
};

export type FreezeResult = {
  /** 通常どおり編集できるプロジェクト ID */
  activeIds: string[];
  /** 閲覧のみに凍結されるプロジェクト ID */
  frozenIds: string[];
  /** アーカイブ済みで判定対象外の ID */
  archivedIds: string[];
};

function time(value: string | Date | null): number | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * 凍結対象を決める。順序は決定的で、同じ入力からは常に同じ結果になる。
 *
 * 並び順:
 *   1. 維持指定 (retainedAt) が新しい順。未指定は後ろ
 *   2. 作成が古い順
 *   3. ID の昇順 (最終的なタイブレーク)
 *
 * 先頭から projectLimit 件が有効、残りが凍結。
 */
export function selectFrozenProjectIds(
  projects: readonly FreezableProject[],
  projectLimit: number | null,
): FreezeResult {
  const archivedIds: string[] = [];
  const candidates: FreezableProject[] = [];

  for (const p of projects) {
    if (p.archivedAt != null) archivedIds.push(p.id);
    else candidates.push(p);
  }

  // 上限なし (Team / Enterprise) は全件が有効
  if (projectLimit === null) {
    return { activeIds: candidates.map((p) => p.id), frozenIds: [], archivedIds };
  }

  const sorted = [...candidates].sort((a, b) => {
    const ra = time(a.retainedAt);
    const rb = time(b.retainedAt);
    if (ra !== rb) {
      if (ra === null) return 1; // 未指定は後ろ
      if (rb === null) return -1;
      return rb - ra; // 維持指定が新しい順
    }
    const ca = time(a.createdAt) ?? 0;
    const cb = time(b.createdAt) ?? 0;
    if (ca !== cb) return ca - cb; // 作成が古い順
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const limit = Math.max(0, projectLimit);
  return {
    activeIds: sorted.slice(0, limit).map((p) => p.id),
    frozenIds: sorted.slice(limit).map((p) => p.id),
    archivedIds,
  };
}

/** 指定プロジェクトが凍結対象かどうか */
export function isProjectFrozen(
  projectId: string,
  projects: readonly FreezableProject[],
  projectLimit: number | null,
): boolean {
  return selectFrozenProjectIds(projects, projectLimit).frozenIds.includes(projectId);
}
