import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isOperatorEmail } from './operatorAuth.js';

// 運営権限の許可リストは環境変数で持つ (#204)。DB からは昇格できない。
const envState: Record<string, unknown> = {};
vi.mock('../lib/env.js', () => ({ getServerEnv: () => envState }));

beforeEach(() => {
  for (const k of Object.keys(envState)) delete envState[k];
});

afterEach(() => vi.clearAllMocks());

describe('isOperatorEmail', () => {
  it('許可リストに載っていれば true', () => {
    envState.TRAKON_OPERATOR_EMAILS = 'ops@trakon.app';
    expect(isOperatorEmail('ops@trakon.app')).toBe(true);
  });

  it('大文字小文字と前後の空白を無視して突き合わせる', () => {
    envState.TRAKON_OPERATOR_EMAILS = ' Ops@Trakon.App , other@trakon.app ';
    expect(isOperatorEmail('ops@trakon.app')).toBe(true);
    expect(isOperatorEmail('OTHER@TRAKON.APP')).toBe(true);
  });

  it('載っていなければ false', () => {
    envState.TRAKON_OPERATOR_EMAILS = 'ops@trakon.app';
    expect(isOperatorEmail('user@example.com')).toBe(false);
  });

  it('未設定なら誰も該当しない (安全側に倒す)', () => {
    expect(isOperatorEmail('ops@trakon.app')).toBe(false);
  });

  it('空文字の設定でも誰も該当しない', () => {
    envState.TRAKON_OPERATOR_EMAILS = ' , ';
    expect(isOperatorEmail('ops@trakon.app')).toBe(false);
  });

  it('メールが無いユーザーは該当しない', () => {
    envState.TRAKON_OPERATOR_EMAILS = 'ops@trakon.app';
    expect(isOperatorEmail(undefined)).toBe(false);
  });

  it('部分一致では通さない', () => {
    envState.TRAKON_OPERATOR_EMAILS = 'ops@trakon.app';
    expect(isOperatorEmail('ops@trakon.app.evil.com')).toBe(false);
    expect(isOperatorEmail('xops@trakon.app')).toBe(false);
  });
});
