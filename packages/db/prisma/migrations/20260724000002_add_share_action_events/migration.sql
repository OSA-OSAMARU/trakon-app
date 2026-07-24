-- -----------------------------------------------------------------------------
-- Migration: 20260724000002_add_share_action_events
-- issue #131 follow-up: 共有リンク(非会員=クライアント)から新状態機械の操作
-- (確認依頼 / 承認 / 差し戻し) を許可するため、audit_logs.action に share_* を追加する。
--   - share_request_review / share_approve / share_send_back
-- TOSS(進行責任者の操作)は共有リンクからは行わないため追加しない。
-- 旧 share_toss / share_complete は CHECK に残す(既存行の互換のため。ルートは廃止)。
--
-- 許可値の追加のみ(スーパーセット)で既存行は全て満たすため、実データへの破壊なし。
-- ball_events 側は既存の source='auto_chain'(system actor, actor 両方 NULL)を再利用するため
-- ck_be_event_type / ck_be_source の変更は不要。
-- -----------------------------------------------------------------------------

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
    'share_send_back'
  ));
