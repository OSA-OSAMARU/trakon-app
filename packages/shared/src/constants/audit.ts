/**
 * 監査ログの action 許可値 (FE/BE 共通)
 * 設計書 §2.4.7 / §5.6.1
 *
 * ここは DB の CHECK 制約 `ck_al_action` と **完全に一致していなければならない**。
 * 値を追加するには CHECK を DROP → 再作成するマイグレーションが必須で、
 * 追加を忘れると audit_logs への INSERT が制約違反で失敗し、
 * **同一トランザクション内の業務処理ごと巻き戻る**。
 * Webhook 経由なら Stripe に 500 を返して再送ループになる。
 *
 * 検出手段として、統合テストで pg_get_constraintdef の実値とこの配列を突き合わせる。
 */

/** Phase 0 からの既存アクション (#131 / 共有リンク系を含む) */
export const AUDIT_ACTIONS_CORE = [
  'login',
  'logout',
  'complete_signup',
  'update_profile',
  'email_changed',
  'account_delete',
  'toss',
  'untoss',
  'complete',
  'undo_complete',
  // #117 で自動連鎖 TOSS は廃止。新規記録はないが許可値としては残す
  'auto_toss',
  'request_review',
  'undo_request_review',
  'approve',
  'undo_approve',
  'send_back',
  'share_access',
  'share_create',
  'share_revoke',
  // 旧共有ルートは廃止済み。既存行の互換のため許可値としては残す
  'share_toss',
  'share_complete',
  'share_request_review',
  'share_approve',
  'share_send_back',
] as const;

/**
 * 課金系アクション (Phase 0.5)。
 * Webhook 起点のものは actor_user_id = NULL、extra.source = 'stripe_webhook' を付ける。
 * audit_logs.resource_id は uuid 型のため Stripe の ID は入らない。
 * resource_type='subscription' / resource_id=organization_id とし、Stripe 側の ID は extra へ。
 */
export const AUDIT_ACTIONS_BILLING = [
  'checkout_started',
  'trial_started',
  'trial_blocked',
  /** トライアル重複判定の手動解除。運用手順 (Runbook) から記録する */
  'trial_released',
  'subscription_created',
  'subscription_updated',
  'subscription_canceled',
  'plan_changed',
  'payment_failed',
  'payment_recovered',
] as const;

/** 組織・ロール系アクション (Phase 0.5) */
export const AUDIT_ACTIONS_ORG = [
  'org_member_added',
  'org_member_removed',
  'org_role_changed',
  'invitation_created',
  'invitation_revoked',
  'project_role_changed',
  'retained_projects_changed',
] as const;

export const AUDIT_ACTIONS = [
  ...AUDIT_ACTIONS_CORE,
  ...AUDIT_ACTIONS_BILLING,
  ...AUDIT_ACTIONS_ORG,
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}
