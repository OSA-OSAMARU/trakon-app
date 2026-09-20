-- =============================================================================
-- Migration: 20260920000002_add_subscription_reconciled_action
-- audit_logs.action に 'subscription_reconciled' を追加する。
-- 設計書: docs/design/02-database.md §2.4.7、05-security.md §5.6.1
--
-- 【背景】
--   #209 で契約状態の照合 (POST /api/v1/billing/sync) を追加したとき、
--   監査ログの action だけ CHECK 制約へ追加し忘れていた。
--   照合が成功して契約を書き込む経路に入ると audit_logs の INSERT が
--   制約違反になり、**同一トランザクションの契約更新ごと巻き戻って 500** になる。
--   「カードを登録したのに Free のまま」が sync でも解消しない状態だった。
--
-- 【実データ影響（精査済み・破壊的操作なし）】
--   許可値の追加のみ (スーパーセット) で既存行はすべて満たす。
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
    'subscription_reconciled',
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
