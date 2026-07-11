/**
 * Ball Holder 導出 (FE/BE 共通)
 * 設計書 §2.6
 */

export type PlanState = 'ready' | 'tossed' | 'completed';

export type BallEventType = 'tossed' | 'completed' | 'toss_undone' | 'completion_undone';

export type BallEventLike = {
  eventType: BallEventType;
  source: 'human' | 'auto_chain';
  occurredAt: string | Date;
};

export type PlanLike = {
  fromMemberId: string | null;
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
 *   - イベント未発生: from_member が Ball Holder, state = 'ready'
 *   - 最新 = tossed: to_member が Ball Holder, state = 'tossed'
 *   - 最新 = completed: to_member が Ball Holder (完了者), state = 'completed'
 *   - 最新 = toss_undone (差し戻し): from_member に戻る, state = 'ready'
 *   - 最新 = completion_undone (完了の差し戻し): 完了直前 (TOSS 済み) に戻る,
 *     to_member が Ball Holder, state = 'tossed' (#89)
 *
 * 各イベントは「遷移後の状態」を表すため、最新イベント 1 件で現状態が決まる
 * (toss_undone は tossed を打ち消し ready に、completion_undone は completed を
 *  打ち消し tossed に戻す)。
 */
export function deriveBallHolder(plan: PlanLike, latestEvent?: BallEventLike | null): BallHolderResult {
  if (!latestEvent || latestEvent.eventType === 'toss_undone') {
    return { memberId: plan.fromMemberId, state: 'ready' };
  }
  if (latestEvent.eventType === 'tossed' || latestEvent.eventType === 'completion_undone') {
    return { memberId: plan.toMemberId, state: 'tossed' };
  }
  return { memberId: plan.toMemberId, state: 'completed' };
}

/** ライン (後続チェーン) 単位のボール保持者導出に使う plan 形状。 */
export type LinePlanLike = {
  id: string;
  /** この予定の「後続の予定」。予定同士を 1 本のラインに繋ぐ。 */
  successorPlanId: string | null;
  status: 'active' | 'completed' | 'canceled';
  /** 予定単体のボール状態 (deriveBallHolder 由来)。 */
  ballState: PlanState;
  fromMemberId: string | null;
  toMemberId: string | null;
};

/**
 * 「ライン」単位で現在のボール保持者を導出する (#117)。
 *
 * ライン = 後続 (successorPlanId) で連結された予定のまとまり。後続で繋がっていない
 * 予定は、期間が重なっていてもそれぞれ独立したラインとして扱う。
 *
 * 各ラインの保持者は、ラインの先頭から辿って最初に見つかる「未完了の予定」で決まる:
 *   - その予定が TOSS されていなければ FROM (実施者)
 *   - TOSS 済みで未完了なら TO (確認者)
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
        const holderId = cur.ballState === 'tossed' ? cur.toMemberId : cur.fromMemberId;
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
