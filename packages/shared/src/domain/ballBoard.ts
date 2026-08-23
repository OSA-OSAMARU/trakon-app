import type { PlanState } from './ballHolder.js';

/**
 * ダッシュボードのボードの列 (Figma node 57:2)。
 *
 * ボール状態機械 6 値 (PlanState) を「いま誰が何を求められているか」で 4 列に畳む。
 * 状態そのものではなく **次に必要な行動** で並べるため、列と状態は 1:1 ではない。
 */
export const BALL_BOARD_COLUMNS = [
  'in_progress',
  'awaiting_reply',
  'return_handling',
  'awaiting_toss',
] as const;

export type BallBoardColumn = (typeof BALL_BOARD_COLUMNS)[number];

export const BALL_BOARD_COLUMN_LABEL: Record<BallBoardColumn, string> = {
  in_progress: '作業中',
  awaiting_reply: '返答待ち',
  return_handling: 'RETURN対応',
  awaiting_toss: '次の工程TOSS待ち',
};

/**
 * ボール状態から列を決める。
 *
 * - in_progress     … 実施者が作業中
 * - review_pending  … 承認者の返答待ち
 * - sent_back       … 差し戻された。実施者が RETURN に対応する必要がある
 * - approved        … 承認済み。進行責任者が次の工程へ TOSS するのを待っている
 *
 * tossed / completed はボードに出さない。tossed はボールが後続予定の実施者へ渡った
 * 状態で、その後続予定自体が別のカードとして出るため二重計上になる。
 */
export function ballBoardColumnOf(state: PlanState): BallBoardColumn | null {
  switch (state) {
    case 'in_progress':
      return 'in_progress';
    case 'review_pending':
      return 'awaiting_reply';
    case 'sent_back':
      return 'return_handling';
    case 'approved':
      return 'awaiting_toss';
    case 'tossed':
    case 'completed':
      return null;
  }
}
