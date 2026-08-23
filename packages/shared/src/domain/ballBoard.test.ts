import { describe, expect, it } from 'vitest';

import {
  BALL_BOARD_COLUMNS,
  BALL_BOARD_COLUMN_LABEL,
  ballBoardColumnOf,
} from './ballBoard.js';

describe('ballBoardColumnOf', () => {
  it('対応が必要な 4 状態をそれぞれの列に振り分ける', () => {
    expect(ballBoardColumnOf('in_progress')).toBe('in_progress');
    expect(ballBoardColumnOf('review_pending')).toBe('awaiting_reply');
    expect(ballBoardColumnOf('sent_back')).toBe('return_handling');
    expect(ballBoardColumnOf('approved')).toBe('awaiting_toss');
  });

  it('tossed / completed はボードに出さない', () => {
    // tossed は後続予定側が別カードとして出るため二重計上になる
    expect(ballBoardColumnOf('tossed')).toBeNull();
    expect(ballBoardColumnOf('completed')).toBeNull();
  });

  it('全列にラベルが定義されている', () => {
    expect(BALL_BOARD_COLUMNS).toHaveLength(4);
    for (const c of BALL_BOARD_COLUMNS) {
      expect(BALL_BOARD_COLUMN_LABEL[c].length).toBeGreaterThan(0);
    }
  });
});
