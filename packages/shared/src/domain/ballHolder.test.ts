import { describe, expect, it } from 'vitest';

import {
  deriveBallHolder,
  deriveLineBallHolders,
  pickLatestBallEvent,
  type LinePlanLike,
} from './ballHolder.js';

describe('deriveBallHolder', () => {
  const plan = {
    fromMemberId: 'from-1',
    toMemberId: 'to-1',
    status: 'active' as const,
  };

  it('returns from member with ready state when no events', () => {
    const r = deriveBallHolder(plan, null);
    expect(r).toEqual({ memberId: 'from-1', state: 'ready' });
  });

  it('returns to member with tossed state on latest tossed event', () => {
    const r = deriveBallHolder(plan, {
      eventType: 'tossed',
      source: 'human',
      occurredAt: '2026-06-01T00:00:00Z',
    });
    expect(r).toEqual({ memberId: 'to-1', state: 'tossed' });
  });

  it('returns to member with completed state on completed event', () => {
    const r = deriveBallHolder(plan, {
      eventType: 'completed',
      source: 'human',
      occurredAt: '2026-06-02T00:00:00Z',
    });
    expect(r).toEqual({ memberId: 'to-1', state: 'completed' });
  });

  it('auto_chain tossed is treated same as human tossed', () => {
    const r = deriveBallHolder(plan, {
      eventType: 'tossed',
      source: 'auto_chain',
      occurredAt: '2026-06-03T00:00:00Z',
    });
    expect(r.state).toBe('tossed');
  });

  it('returns from member with ready state on toss_undone event', () => {
    const r = deriveBallHolder(plan, {
      eventType: 'toss_undone',
      source: 'human',
      occurredAt: '2026-06-04T00:00:00Z',
    });
    expect(r).toEqual({ memberId: 'from-1', state: 'ready' });
  });

  it('returns to member with tossed state on completion_undone event (#89)', () => {
    const r = deriveBallHolder(plan, {
      eventType: 'completion_undone',
      source: 'human',
      occurredAt: '2026-06-05T00:00:00Z',
    });
    expect(r).toEqual({ memberId: 'to-1', state: 'tossed' });
  });
});

describe('pickLatestBallEvent', () => {
  it('returns null on empty', () => {
    expect(pickLatestBallEvent([])).toBeNull();
  });

  it('picks the event with the largest occurredAt', () => {
    const a = { eventType: 'tossed' as const, source: 'human' as const, occurredAt: '2026-06-01T00:00:00Z' };
    const b = { eventType: 'completed' as const, source: 'human' as const, occurredAt: '2026-06-02T00:00:00Z' };
    const c = { eventType: 'tossed' as const, source: 'auto_chain' as const, occurredAt: '2026-06-01T12:00:00Z' };
    expect(pickLatestBallEvent([a, b, c])).toBe(b);
  });
});

describe('deriveLineBallHolders (#117)', () => {
  // 前提A: ワイヤー作成 → デザイン作成 が後続で繋がっている
  //   ワイヤー: FROM=田中 TO=佐藤 / デザイン: FROM=山田 TO=高橋
  const lineA = (
    wire: { status: LinePlanLike['status']; ballState: LinePlanLike['ballState'] },
    design: { status: LinePlanLike['status']; ballState: LinePlanLike['ballState'] },
  ): LinePlanLike[] => [
    { id: 'wire', successorPlanId: 'design', fromMemberId: 'tanaka', toMemberId: 'sato', ...wire },
    { id: 'design', successorPlanId: null, fromMemberId: 'yamada', toMemberId: 'takahashi', ...design },
  ];

  const READY = { status: 'active' as const, ballState: 'ready' as const };
  const TOSSED = { status: 'active' as const, ballState: 'tossed' as const };
  const DONE = { status: 'completed' as const, ballState: 'completed' as const };

  it('ケース1/5: ワイヤー未TOSS → 田中 (FROM)', () => {
    expect(deriveLineBallHolders(lineA(READY, READY))).toEqual(['tanaka']);
  });

  it('ケース2/6: ワイヤーTOSS済・未完了 → 佐藤 (TO)', () => {
    expect(deriveLineBallHolders(lineA(TOSSED, READY))).toEqual(['sato']);
  });

  it('ケース3/7: ワイヤー完了・デザイン未TOSS → 山田 (後続のFROM)', () => {
    expect(deriveLineBallHolders(lineA(DONE, READY))).toEqual(['yamada']);
  });

  it('ケース4/8: ワイヤー完了・デザインTOSS済未完了 → 高橋 (後続のTO)', () => {
    expect(deriveLineBallHolders(lineA(DONE, TOSSED))).toEqual(['takahashi']);
  });

  it('ケース9: ワイヤー・デザインとも完了 → 保持者なし', () => {
    expect(deriveLineBallHolders(lineA(DONE, DONE))).toEqual([]);
  });

  // 前提B: 後続で繋がっていない2予定は別ラインとして扱い、保持者は2名になる
  const lineB = (
    wire: { status: LinePlanLike['status']; ballState: LinePlanLike['ballState'] },
    flyer: { status: LinePlanLike['status']; ballState: LinePlanLike['ballState'] },
  ): LinePlanLike[] => [
    { id: 'wire', successorPlanId: null, fromMemberId: 'tanaka', toMemberId: 'sato', ...wire },
    { id: 'flyer', successorPlanId: null, fromMemberId: 'yamada', toMemberId: 'takahashi', ...flyer },
  ];

  it('前提B: 独立した2ライン → 保持者は2名 (それぞれの状態で決まる)', () => {
    expect(deriveLineBallHolders(lineB(READY, READY))).toEqual(['tanaka', 'yamada']);
    expect(deriveLineBallHolders(lineB(TOSSED, TOSSED))).toEqual(['sato', 'takahashi']);
    expect(deriveLineBallHolders(lineB(DONE, READY))).toEqual(['yamada']);
  });

  it('同一人物が複数ラインを持つ場合は重複を除く', () => {
    const plans: LinePlanLike[] = [
      { id: 'a', successorPlanId: null, fromMemberId: 'tanaka', toMemberId: 'sato', ...READY },
      { id: 'b', successorPlanId: null, fromMemberId: 'tanaka', toMemberId: 'x', ...READY },
    ];
    expect(deriveLineBallHolders(plans)).toEqual(['tanaka']);
  });

  it('canceled の予定は無視する', () => {
    const plans: LinePlanLike[] = [
      { id: 'a', successorPlanId: null, fromMemberId: 'tanaka', toMemberId: 'sato', status: 'canceled', ballState: 'ready' },
      { id: 'b', successorPlanId: null, fromMemberId: 'yamada', toMemberId: 'takahashi', ...READY },
    ];
    expect(deriveLineBallHolders(plans)).toEqual(['yamada']);
  });

  it('保持者が空/未設定なら詰めて返す', () => {
    const plans: LinePlanLike[] = [
      { id: 'a', successorPlanId: null, fromMemberId: null, toMemberId: null, ...READY },
    ];
    expect(deriveLineBallHolders(plans)).toEqual([]);
  });
});
