/**
 * Ball Holder 導出 (FE/BE 共通)
 * 設計書 §2.6
 */

export type PlanState = 'ready' | 'tossed' | 'completed';

export type BallEventType = 'tossed' | 'completed' | 'toss_undone';

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
 *
 * 各イベントは「遷移後の状態」を表すため、最新イベント 1 件で現状態が決まる
 * (toss_undone は直前の tossed を打ち消し ready に戻す)。
 */
export function deriveBallHolder(plan: PlanLike, latestEvent?: BallEventLike | null): BallHolderResult {
  if (!latestEvent || latestEvent.eventType === 'toss_undone') {
    return { memberId: plan.fromMemberId, state: 'ready' };
  }
  if (latestEvent.eventType === 'tossed') {
    return { memberId: plan.toMemberId, state: 'tossed' };
  }
  return { memberId: plan.toMemberId, state: 'completed' };
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
