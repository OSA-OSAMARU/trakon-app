-- -----------------------------------------------------------------------------
-- 差し戻し (toss_undone) イベント種別を追加
-- ball_events は append-only (UPDATE/DELETE 拒否) のため、TOSS の取り消しは
-- 行削除ではなく 'toss_undone' イベントの追記で表現する。
-- 最新イベントが 'toss_undone' のとき state = 'ready' (from_member に戻る)。
-- -----------------------------------------------------------------------------

ALTER TABLE "ball_events" DROP CONSTRAINT "ck_be_event_type";

ALTER TABLE "ball_events"
  ADD CONSTRAINT "ck_be_event_type"
  CHECK ("event_type" IN ('tossed', 'completed', 'toss_undone'));
