import { describe, expect, it } from 'vitest';

import {
  deriveBallHolder,
  deriveLineBallHolders,
  pickLatestBallEvent,
  type BallEventType,
  type LinePlanLike,
  type PlanLike,
} from './ballHolder.js';

describe('deriveBallHolder (#131 状態機械)', () => {
  const plan: PlanLike = {
    executorMemberId: 'exec-1',
    approverMemberId: 'appr-1',
    progressManagerMemberId: 'pm-1',
    toMemberId: 'to-1',
    status: 'active',
  };

  const ev = (eventType: BallEventType): { eventType: BallEventType; source: 'human'; occurredAt: string } => ({
    eventType,
    source: 'human',
    occurredAt: '2026-07-01T00:00:00Z',
  });

  // 状態遷移の網羅表: 最新イベント → (state, holder)
  const cases: Array<[string, BallEventType | null, PlanLike['status'], PlanLike, string | null, string]> = [
    ['イベントなし → 実施中/実施者', null, 'active', plan, 'exec-1', 'in_progress'],
    ['review_requested → 確認待ち/承認者', 'review_requested', 'active', plan, 'appr-1', 'review_pending'],
    ['approved → 承認済み/進行責任者', 'approved', 'active', plan, 'pm-1', 'approved'],
    ['tossed → TOSS済み/後続実施者(toMember)', 'tossed', 'active', plan, 'to-1', 'tossed'],
    ['sent_back → 差し戻し/実施者', 'sent_back', 'active', plan, 'exec-1', 'sent_back'],
    ['review_request_undone → 実施中/実施者', 'review_request_undone', 'active', plan, 'exec-1', 'in_progress'],
    ['approval_undone(承認者あり) → 確認待ち/承認者', 'approval_undone', 'active', plan, 'appr-1', 'review_pending'],
    // レガシー互換
    ['toss_undone(レガシー) → 実施中/実施者', 'toss_undone', 'active', plan, 'exec-1', 'in_progress'],
    ['completed(レガシー) → 完了/toMember', 'completed', 'completed', plan, 'to-1', 'completed'],
    ['completion_undone(レガシー) → TOSS済み/toMember', 'completion_undone', 'active', plan, 'to-1', 'tossed'],
  ];

  it.each(cases)('%s', (_label, eventType, status, p, expectedMember, expectedState) => {
    const r = deriveBallHolder({ ...p, status }, eventType ? ev(eventType) : null);
    expect(r).toEqual({ memberId: expectedMember, state: expectedState });
  });

  it('承認者なしで approval_undone → 実施中/実施者', () => {
    const noApprover: PlanLike = { ...plan, approverMemberId: null };
    const r = deriveBallHolder(noApprover, ev('approval_undone'));
    expect(r).toEqual({ memberId: 'exec-1', state: 'in_progress' });
  });

  it('auto_chain tossed は human tossed と同一扱い', () => {
    const r = deriveBallHolder(plan, { eventType: 'tossed', source: 'auto_chain', occurredAt: '2026-07-02T00:00:00Z' });
    expect(r.state).toBe('tossed');
  });

  it('各ロールが未設定なら memberId=null (導出不能)', () => {
    const empty: PlanLike = {
      executorMemberId: null,
      approverMemberId: null,
      progressManagerMemberId: null,
      toMemberId: null,
      status: 'active',
    };
    expect(deriveBallHolder(empty, null)).toEqual({ memberId: null, state: 'in_progress' });
    expect(deriveBallHolder(empty, ev('approved'))).toEqual({ memberId: null, state: 'approved' });
  });
});

describe('pickLatestBallEvent', () => {
  it('returns null on empty', () => {
    expect(pickLatestBallEvent([])).toBeNull();
  });

  it('picks the event with the largest occurredAt', () => {
    const a = { eventType: 'approved' as const, source: 'human' as const, occurredAt: '2026-07-01T00:00:00Z' };
    const b = { eventType: 'tossed' as const, source: 'human' as const, occurredAt: '2026-07-02T00:00:00Z' };
    const c = { eventType: 'review_requested' as const, source: 'human' as const, occurredAt: '2026-07-01T12:00:00Z' };
    expect(pickLatestBallEvent([a, b, c])).toBe(b);
  });
});

describe('deriveLineBallHolders (#117 / #131)', () => {
  // ライン: デザイン作成 → デザイン確認 が後続で繋がっている
  //   作成: 実施者=横山 承認者=宮丸 進行責任者=宮丸 / 確認: 実施者=クライアント
  const roles = {
    create: { executorMemberId: 'yokoyama', approverMemberId: 'miyamaru', progressManagerMemberId: 'miyamaru', toMemberId: 'client' },
    review: { executorMemberId: 'client', approverMemberId: 'client', progressManagerMemberId: 'miyamaru', toMemberId: 'engineer' },
  };

  const line = (
    create: { status: LinePlanLike['status']; ballState: LinePlanLike['ballState'] },
    review: { status: LinePlanLike['status']; ballState: LinePlanLike['ballState'] },
  ): LinePlanLike[] => [
    { id: 'create', successorPlanId: 'review', ...roles.create, ...create },
    { id: 'review', successorPlanId: null, ...roles.review, ...review },
  ];

  const IN_PROGRESS = { status: 'active' as const, ballState: 'in_progress' as const };
  const REVIEW = { status: 'active' as const, ballState: 'review_pending' as const };
  const APPROVED = { status: 'active' as const, ballState: 'approved' as const };
  const TOSSED = { status: 'active' as const, ballState: 'tossed' as const };
  const DONE = { status: 'completed' as const, ballState: 'approved' as const };

  it('作成が実施中 → 実施者(横山)', () => {
    expect(deriveLineBallHolders(line(IN_PROGRESS, IN_PROGRESS))).toEqual(['yokoyama']);
  });

  it('作成が確認待ち → 承認者(宮丸)', () => {
    expect(deriveLineBallHolders(line(REVIEW, IN_PROGRESS))).toEqual(['miyamaru']);
  });

  it('作成が承認済み・TOSS待ち → 進行責任者(宮丸)', () => {
    expect(deriveLineBallHolders(line(APPROVED, IN_PROGRESS))).toEqual(['miyamaru']);
  });

  it('作成完了(TOSS済) → 後続の実施者(クライアント)', () => {
    expect(deriveLineBallHolders(line(DONE, IN_PROGRESS))).toEqual(['client']);
  });

  it('後続を確認クライアントが承認済み → 後続の進行責任者(宮丸)', () => {
    expect(deriveLineBallHolders(line(DONE, APPROVED))).toEqual(['miyamaru']);
  });

  it('全完了 → 保持者なし', () => {
    expect(deriveLineBallHolders(line(DONE, DONE))).toEqual([]);
  });

  it('独立した2ラインは保持者2名、重複は除去', () => {
    const plans: LinePlanLike[] = [
      { id: 'a', successorPlanId: null, executorMemberId: 'tanaka', approverMemberId: null, progressManagerMemberId: 'pm', toMemberId: null, ...IN_PROGRESS },
      { id: 'b', successorPlanId: null, executorMemberId: 'tanaka', approverMemberId: null, progressManagerMemberId: 'pm', toMemberId: null, ...IN_PROGRESS },
    ];
    expect(deriveLineBallHolders(plans)).toEqual(['tanaka']);
  });

  it('canceled の予定は無視する', () => {
    const plans: LinePlanLike[] = [
      { id: 'a', successorPlanId: null, executorMemberId: 'tanaka', approverMemberId: null, progressManagerMemberId: null, toMemberId: null, status: 'canceled', ballState: 'in_progress' },
      { id: 'b', successorPlanId: null, executorMemberId: 'yamada', approverMemberId: null, progressManagerMemberId: null, toMemberId: null, ...IN_PROGRESS },
    ];
    expect(deriveLineBallHolders(plans)).toEqual(['yamada']);
  });

  it('TOSS済(status=active レガシー)は後続へ辿らずTOで停止', () => {
    // 旧モデルの tossed は status=active のまま。holderByState で toMember を返し停止。
    expect(deriveLineBallHolders(line(TOSSED, IN_PROGRESS))).toEqual(['client']);
  });
});
