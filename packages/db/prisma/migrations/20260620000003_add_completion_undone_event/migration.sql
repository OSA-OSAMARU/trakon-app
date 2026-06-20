-- -----------------------------------------------------------------------------
-- Migration: 20260620000003_add_completion_undone_event
-- 完了の差し戻し (#89) のため、ball_events.event_type に 'completion_undone' を、
-- audit_logs.action に 'undo_complete' を追加する。
--  - completion_undone: 完了 (completed) を取り消し、TOSS 済み状態に戻すイベント。
--    append-only のため completed 行は削除せず追記で打ち消す (toss_undone と同様)。
--  - undo_complete: 完了差し戻しの監査アクション。
-- これらが CHECK 制約に含まれていないと INSERT が CHECK 違反で失敗する。
-- -----------------------------------------------------------------------------

ALTER TABLE "ball_events" DROP CONSTRAINT "ck_be_event_type";

ALTER TABLE "ball_events"
  ADD CONSTRAINT "ck_be_event_type"
  CHECK ("event_type" IN ('tossed', 'completed', 'toss_undone', 'completion_undone'));

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
    'undo_complete',
    'auto_toss',
    'share_access',
    'share_create',
    'share_revoke',
    'share_toss',
    'share_complete'
  ));
