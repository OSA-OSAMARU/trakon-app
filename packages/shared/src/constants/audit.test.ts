import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTIONS,
  AUDIT_ACTIONS_BILLING,
  AUDIT_ACTIONS_CORE,
  AUDIT_ACTIONS_ORG,
  isAuditAction,
} from './audit.js';

// ここは DB の CHECK 制約 ck_al_action と完全一致していなければならない。
// 実 DB との突き合わせは統合テスト (pg_get_constraintdef) 側で行うため、
// ここでは配列そのものの健全性 — 重複がないこと・欠落がないこと — を守る。

describe('監査ログの action 許可値', () => {
  it('3 グループの連結で、取りこぼしがない', () => {
    expect(AUDIT_ACTIONS).toHaveLength(
      AUDIT_ACTIONS_CORE.length + AUDIT_ACTIONS_BILLING.length + AUDIT_ACTIONS_ORG.length,
    );
    for (const group of [AUDIT_ACTIONS_CORE, AUDIT_ACTIONS_BILLING, AUDIT_ACTIONS_ORG]) {
      for (const action of group) {
        expect(AUDIT_ACTIONS).toContain(action);
      }
    }
  });

  it('重複した値がない (CHECK 制約の再作成時に紛れ込みやすい)', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it('Phase 0 からの既存アクションを 1 つも落としていない', () => {
    // 過去行が読めなくなるため、既存値の削除は許されない
    expect(AUDIT_ACTIONS_CORE).toContain('login');
    expect(AUDIT_ACTIONS_CORE).toContain('toss');
    expect(AUDIT_ACTIONS_CORE).toContain('share_access');
    // 廃止済みだが既存行の互換のため許可値としては残す
    expect(AUDIT_ACTIONS_CORE).toContain('auto_toss');
    expect(AUDIT_ACTIONS_CORE).toContain('share_toss');
  });

  it('課金・組織系のアクションが揃っている', () => {
    expect(AUDIT_ACTIONS_BILLING).toContain('trial_released');
    expect(AUDIT_ACTIONS_BILLING).toContain('payment_failed');
    expect(AUDIT_ACTIONS_ORG).toContain('project_role_changed');
    expect(AUDIT_ACTIONS_ORG).toContain('retained_projects_changed');
  });

  describe('isAuditAction', () => {
    it('許可値を受け入れる', () => {
      expect(isAuditAction('plan_changed')).toBe(true);
      expect(isAuditAction('login')).toBe(true);
    });

    it('未知の値を弾く', () => {
      expect(isAuditAction('subscription_exploded')).toBe(false);
      expect(isAuditAction('')).toBe(false);
    });
  });
});
