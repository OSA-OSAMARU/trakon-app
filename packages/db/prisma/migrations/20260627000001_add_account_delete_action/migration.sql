-- -----------------------------------------------------------------------------
-- Migration: 20260627000001_add_account_delete_action
-- 退会処理 (#95) のため、audit_logs.action に 'account_delete' を追加する。
--  - account_delete: ユーザー自身による退会 (論理削除 + 匿名化 + Supabase Auth 削除)
--    の監査アクション。退会理由は audit_logs.extra.reason に格納する。
-- この値が ck_al_action CHECK 制約に含まれていないと INSERT が CHECK 違反で失敗する。
-- -----------------------------------------------------------------------------

ALTER TABLE "audit_logs" DROP CONSTRAINT "ck_al_action";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "ck_al_action" CHECK ("action" IN (
    'login',
    'logout',
    'complete_signup',
    'update_profile',
    'account_delete',
    'toss',
    'untoss',
    'complete',
    'undo_complete',
    'auto_toss',
    'share_access',
    'share_create',
    'share_revoke',
    'share_toss',
    'share_complete'
  ));
