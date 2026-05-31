-- -----------------------------------------------------------------------------
-- 監査ログの action に 'update_profile' と 'untoss' を追加
--  - update_profile: PATCH /auth/me (氏名・表示名・パスワード変更)
--  - untoss:         TOSS 差し戻し (toss_undone)
-- これらが ck_al_action に含まれていないと audit_logs INSERT が CHECK 違反で失敗する。
-- -----------------------------------------------------------------------------

ALTER TABLE "audit_logs" DROP CONSTRAINT "ck_al_action";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "ck_al_action" CHECK ("action" IN (
    'login',
    'logout',
    'complete_signup',
    'update_profile',
    'toss',
    'untoss',
    'complete',
    'auto_toss',
    'share_access',
    'share_create',
    'share_revoke',
    'share_toss',
    'share_complete'
  ));
