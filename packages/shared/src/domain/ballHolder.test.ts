import { describe, expect, it } from 'vitest';

import { deriveBallHolder, pickLatestBallEvent } from './ballHolder.js';

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
