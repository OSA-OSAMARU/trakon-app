-- -----------------------------------------------------------------------------
-- Migration: 20260712000001_add_email_changed_action
-- メールアドレス変更機能 (#129) のため、audit_logs.action に 'email_changed' を追加する。
--  - email_changed: パスワード認証ユーザーが Supabase 組み込みの email 変更フロー
--    (updateUser({ email }) → 新旧両アドレス確認メール) を完了し、public.users.email を
--    新メールへ同期 (syncUser) した際の監査アクション。旧メールは
--    audit_logs.extra.previousEmail に格納する。
-- この値が ck_al_action CHECK 制約に含まれていないと INSERT が CHECK 違反で失敗する。
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
    'share_access',
    'share_create',
    'share_revoke',
    'share_toss',
    'share_complete'
  ));
