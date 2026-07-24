/**
 * Ball Holder 導出 (FE/BE 共通)
 * 設計書 §2.6 / issue #131
 *
 * #131 で予定に 3 つの役割を導入し、ボールの状態機械を拡張した:
 *   - 実施者 (executor): 作業/確認を行う。必須。
 *   - 承認者 (approver): 実施者の成果を承認する。任意。
 *   - 進行責任者 (progressManager): 承認済みの予定を後続へ TOSS する。必須。
 *
 * FROM/TO は「予定の固定属性」ではなく「TOSS 実行時の履歴スナップショット」
 * (FROM=TOSS した進行責任者 / TO=後続予定の実施者、§14) に意味が変わった。
 */

export type PlanState =
  /** 実施中: 実施者にボール */
  | 'in_progress'
  /** 確認待ち: 承認者にボール */
  | 'review_pending'
  /** 承認済み・TOSS 待ち: 進行責任者にボール */
  | 'approved'
  /** TOSS 済み: 後続予定の実施者 (toMember 履歴) にボール */
  | 'tossed'
  /** 差し戻し: 実施者にボール (承認者が実施側へ戻した) */
  | 'sent_back'
  /** 完了 (レガシー completed イベント由来。新モデルでは status 列で表現) */
  | 'completed';

export type BallEventType =
  // 新モデル (#131)
  | 'review_requested'
  | 'approved'
  | 'sent_back'
  | 'review_request_undone'
  | 'approval_undone'
  // TOSS (意味は #131 で「進行責任者→後続実施者」へ変化)
  | 'tossed'
  // レガシー (旧モデルのイベント。既存データの後方互換のため解釈を維持)
  | 'completed'
  | 'toss_undone'
  | 'completion_undone';

export type BallEventLike = {
  eventType: BallEventType;
  source: 'human' | 'auto_chain';
  occurredAt: string | Date;
};

export type PlanLike = {
  executorMemberId: string | null;
  approverMemberId: string | null;
  progressManagerMemberId: string | null;
  /** TOSS 履歴スナップショット TO=後続予定の実施者 (tossed 状態のホルダー) */
  toMemberId: string | null;
  status: 'active' | 'completed' | 'canceled';
};

export type BallHolderResult = {
  /** 現在のホルダー member_id (NULL は導出不能ケース) */
  memberId: string | null;
  state: PlanState;
};

/**
 * plans + 最新の ball_events から Ball Holder を導出する。
 *
 * 「各イベントは遷移後の状態を表す」不変条件を維持し、最新イベント 1 件で現状態が
 * 決まる。承認とTOSSを分離したため状態は 6 値に拡張。
 *
 * 新モデルのイベント:
 *   - (なし) / review_request_undone → 実施中 (実施者)
 *   - sent_back                      → 差し戻し (実施者)
 *   - review_requested               → 確認待ち (承認者)
 *   - approval_undone                → 承認者あり: 確認待ち (承認者) / なし: 実施中 (実施者)
 *   - approved                       → 承認済み・TOSS待ち (進行責任者)
 *   - tossed                         → TOSS済み (後続実施者 = toMember)
 *
 * TOSS の取り消しは「approved を再追記」して承認済みへ戻す (新モデルは toss_undone を
 * 発行しない)。これにより下記レガシーイベントの解釈と衝突しない。
 *
 * レガシーイベント (旧モデルの既存データのみ。新コードは発行しない):
 *   - toss_undone       → 実施中 (実施者)。旧 'ready' = FROM(=実施者にバックフィル)。
 *   - completed         → 完了 (toMember)
 *   - completion_undone → TOSS済み (toMember)
 */
export function deriveBallHolder(plan: PlanLike, latestEvent?: BallEventLike | null): BallHolderResult {
  const t = latestEvent?.eventType;

  switch (t) {
    case 'review_requested':
      return { memberId: plan.approverMemberId, state: 'review_pending' };
    case 'approval_undone':
      return plan.approverMemberId
        ? { memberId: plan.approverMemberId, state: 'review_pending' }
        : { memberId: plan.executorMemberId, state: 'in_progress' };
    case 'approved':
      return { memberId: plan.progressManagerMemberId, state: 'approved' };
    case 'sent_back':
      return { memberId: plan.executorMemberId, state: 'sent_back' };
    case 'tossed':
    case 'completion_undone':
      return { memberId: plan.toMemberId, state: 'tossed' };
    case 'completed':
      return { memberId: plan.toMemberId, state: 'completed' };
    // (なし) / review_request_undone / toss_undone(レガシー) → 実施中
    default:
      return { memberId: plan.executorMemberId, state: 'in_progress' };
  }
}

/** ライン (後続チェーン) 単位のボール保持者導出に使う plan 形状。 */
export type LinePlanLike = {
  id: string;
  /** この予定の「後続の予定」。予定同士を 1 本のラインに繋ぐ。 */
  successorPlanId: string | null;
  status: 'active' | 'completed' | 'canceled';
  /** 予定単体のボール状態 (deriveBallHolder 由来)。 */
  ballState: PlanState;
  executorMemberId: string | null;
  approverMemberId: string | null;
  progressManagerMemberId: string | null;
  toMemberId: string | null;
};

/** 予定単体の ballState から、その予定を保持している member_id を引く。 */
function holderByState(p: LinePlanLike): string | null {
  switch (p.ballState) {
    case 'review_pending':
      return p.approverMemberId;
    case 'approved':
      return p.progressManagerMemberId;
    case 'tossed':
    case 'completed':
      return p.toMemberId;
    // in_progress / sent_back
    default:
      return p.executorMemberId;
  }
}

/**
 * 「ライン」単位で現在のボール保持者を導出する (#117 / #131)。
 *
 * ライン = 後続 (successorPlanId) で連結された予定のまとまり。後続で繋がっていない
 * 予定は、期間が重なっていてもそれぞれ独立したラインとして扱う。
 *
 * 各ラインの保持者は、ラインの先頭から辿って最初に見つかる「未完了の予定」で決まる:
 *   - status='completed' の予定は後続へ引き継ぎ済みとして次へ辿る
 *     (新モデルでは TOSS で先行が completed になる)
 *   - 未完了の予定に到達したらその ballState に応じた保持者を返す
 *
 * ラインの予定がすべて完了していれば、そのラインに保持者はいない (後続が無いため)。
 *
 * 独立したラインが複数あれば保持者も複数になりうる。同一人物が複数ラインを持つ
 * 場合は重複を除いた distinct な member_id 配列を、入力順を保って返す。
 * canceled の予定は無視する。
 */
export function deriveLineBallHolders(plans: LinePlanLike[]): string[] {
  const active = plans.filter((p) => p.status !== 'canceled');
  const byId = new Map(active.map((p) => [p.id, p]));
  // 誰かの後続として指されている予定はラインの先頭ではない。
  const successorIds = new Set(
    active
      .map((p) => p.successorPlanId)
      .filter((id): id is string => id !== null),
  );
  const heads = active.filter((p) => !successorIds.has(p.id));

  const holders: string[] = [];
  for (const head of heads) {
    let cur: LinePlanLike | undefined = head;
    const visited = new Set<string>();
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      if (cur.status !== 'completed') {
        const holderId = holderByState(cur);
        if (holderId) holders.push(holderId);
        break;
      }
      // 完了済みなら後続へ。後続が無ければ (= 全完了) このラインに保持者はいない。
      cur = cur.successorPlanId ? byId.get(cur.successorPlanId) : undefined;
    }
  }
  return [...new Set(holders)];
}

/**
 * `ball_events` の配列から「最新のイベント」を取り出す。
 * occurredAt の降順ソートを前提としない (呼び出し側でソートしていない可能性に備え)。
 */
export function pickLatestBallEvent<T extends BallEventLike>(events: T[]): T | null {
  if (events.length === 0) return null;
  return events.reduce((latest, ev) =>
    new Date(ev.occurredAt) > new Date(latest.occurredAt) ? ev : latest,
  );
}
