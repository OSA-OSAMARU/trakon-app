-- =============================================================================
-- Migration: 20260901000005_extend_audit_actions_billing
-- Phase 0.5 (有料プラン): audit_logs.action に課金系の値を追加する。
-- 設計書: docs/design/02-database.md §2.4.7、05-security.md §5.6.1
--
-- 【実データ影響（精査済み・破壊的操作なし）】
--   許可値の追加のみ (スーパーセット) で既存行はすべて満たす。
--
-- 【重要】許可値の追加を忘れると audit_logs への INSERT が制約違反で失敗し、
--   同一トランザクション内の業務処理ごと巻き戻る。Webhook 経由なら Stripe に
--   500 を返して再送ループになる。許可値は packages/shared/src/constants/audit.ts に
--   一元化し、pg_get_constraintdef と突き合わせる統合テストで検出する。
-- =============================================================================

ALTER TABLE "audit_logs" DROP CONSTRAINT "ck_al_action";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "ck_al_action" CHECK ("action" IN (
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
    'auto_toss',
    'request_review',
    'undo_request_review',
    'approve',
    'undo_approve',
    'send_back',
    'share_access',
    'share_create',
    'share_revoke',
    'share_toss',
    'share_complete',
    'share_request_review',
    'share_approve',
    'share_send_back',
    -- 課金系 (Phase 0.5)
    'checkout_started',
    'trial_started',
    'trial_blocked',
    'trial_released',
    'subscription_created',
    'subscription_updated',
    'subscription_canceled',
    'plan_changed',
    'payment_failed',
    'payment_recovered',
    -- 組織・ロール系 (Phase 0.5)
    'org_member_added',
    'org_member_removed',
    'org_role_changed',
    'invitation_created',
    'invitation_revoked',
    'project_role_changed',
    'retained_projects_changed'
  ));
