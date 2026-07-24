-- -----------------------------------------------------------------------------
-- Migration: 20260724000001_add_plan_roles
-- issue #131「確認者付き予定と進行責任者の追加」PR1: DB 土台。
--
-- 目的:
--   予定に 3 つの役割 (実施者 executor / 承認者 approver / 進行責任者 progressManager)
--   を持たせ、ボールの状態機械を「実施中 → 確認待ち → 承認済み → TOSS済み」へ拡張する
--   ための列・制約・イベント種別を追加する。UI/サービス層の切替は後続 PR。
--
-- 実データ影響 (精査済み・破壊的操作なし):
--   * 追加する列はすべて nullable UUID。既存行は NULL が入るだけ (テーブル書き換えなし)。
--   * 既存 from_member_id / to_member_id は残す (併存)。DROP COLUMN / DELETE は無い。
--   * CHECK 変更は許可値の「追加」= スーパーセットのため、既存の全行が新制約を満たす。
--   * 新 FK は既存同様 ON DELETE RESTRICT。値は NULL か有効メンバー由来なので拒否されない。
--   * バックフィルは「新列を埋めるだけ」で既存列は書き換えない。updated_at を保持するため
--     set_updated_at トリガを一時 DISABLE する。
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 1. 列の追加 (nullable, 非破壊)
-- =============================================================================
ALTER TABLE "projects"
  ADD COLUMN "progress_manager_member_id" UUID;

ALTER TABLE "plans"
  ADD COLUMN "executor_member_id"         UUID,
  ADD COLUMN "approver_member_id"         UUID,
  ADD COLUMN "progress_manager_member_id" UUID;

COMMENT ON COLUMN "projects"."progress_manager_member_id" IS '予定作成時の進行責任者の既定値 (#131)';
COMMENT ON COLUMN "plans"."executor_member_id"         IS '実施者 (#131)';
COMMENT ON COLUMN "plans"."approver_member_id"         IS '承認者 (#131, 任意)';
COMMENT ON COLUMN "plans"."progress_manager_member_id" IS '進行責任者 (#131)';
COMMENT ON COLUMN "plans"."from_member_id" IS 'TOSS 履歴スナップショット FROM=TOSS した進行責任者 (#131 §14)';
COMMENT ON COLUMN "plans"."to_member_id"   IS 'TOSS 履歴スナップショット TO=後続予定の実施者 (#131 §14)';

-- =============================================================================
-- 2. インデックス
-- =============================================================================
CREATE INDEX "idx_plans_executor_member"         ON "plans"("executor_member_id");
CREATE INDEX "idx_plans_progress_manager_member" ON "plans"("progress_manager_member_id");

-- =============================================================================
-- 3. CHECK 制約の拡張 (許可値の追加 = スーパーセット)
-- =============================================================================
-- 3a. ball_events.event_type に #131 の新イベントを追加
ALTER TABLE "ball_events" DROP CONSTRAINT "ck_be_event_type";
ALTER TABLE "ball_events"
  ADD CONSTRAINT "ck_be_event_type" CHECK ("event_type" IN (
    'tossed',
    'completed',
    'toss_undone',
    'completion_undone',
    'review_requested',
    'approved',
    'sent_back',
    'review_request_undone',
    'approval_undone'
  ));

-- 3b. audit_logs.action に #131 の新アクションを追加
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
    'share_complete'
  ));

-- 3c. ck_plans_toss_members を撤去。
--   旧制約は from/to を「実施者/確認者」として from <> to を強制していたが、#131 では
--   from/to は TOSS 履歴スナップショット (進行責任者→後続実施者) に意味が変わり、かつ
--   1 人が複数役割を兼ねうる (§5) ため from = to もありうる。役割相違制約は課さない。
ALTER TABLE "plans" DROP CONSTRAINT "ck_plans_toss_members";

-- =============================================================================
-- 4. バックフィル (新列のみ書き込み。updated_at 保持のためトリガを一時停止)
-- =============================================================================
ALTER TABLE "plans"    DISABLE TRIGGER "trg_plans_set_updated_at";
ALTER TABLE "projects" DISABLE TRIGGER "trg_projects_set_updated_at";

-- 4a. 実施者 ← 旧 FROM (from_member_id は既に FK 有効)
UPDATE "plans"
  SET "executor_member_id" = "from_member_id"
  WHERE "from_member_id" IS NOT NULL;

-- 4b. プロジェクト既定の進行責任者 ← 作成者(created_by)の該当メンバー行 (無ければ NULL)
UPDATE "projects" AS p
  SET "progress_manager_member_id" = pm."id"
  FROM "project_members" AS pm
  WHERE pm."project_id" = p."id"
    AND pm."user_id"    = p."created_by"
    AND pm."deleted_at" IS NULL;

-- 4c. 既存予定の進行責任者 ← 作成者の該当メンバー行 (item → project 経由。無ければ NULL)。
--     既存予定を新ルール (承認→TOSS) で操作可能にするため。
UPDATE "plans" AS pl
  SET "progress_manager_member_id" = pm."id"
  FROM "project_items" AS pi
  JOIN "projects"        AS p  ON p."id"  = pi."project_id"
  JOIN "project_members" AS pm ON pm."project_id" = p."id"
                              AND pm."user_id"    = p."created_by"
                              AND pm."deleted_at" IS NULL
  WHERE pl."item_id" = pi."id";

-- approver_member_id は NULL のまま (旧 TO は "確認者" ではなく "次工程" 相当のため移さない)

ALTER TABLE "plans"    ENABLE TRIGGER "trg_plans_set_updated_at";
ALTER TABLE "projects" ENABLE TRIGGER "trg_projects_set_updated_at";

-- =============================================================================
-- 5. 外部キー (バックフィル後に追加し、実データを検証)
-- =============================================================================
ALTER TABLE "projects"
  ADD CONSTRAINT "fk_projects_progress_manager_member_id"
  FOREIGN KEY ("progress_manager_member_id") REFERENCES "project_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "plans"
  ADD CONSTRAINT "fk_plans_executor_member_id"
  FOREIGN KEY ("executor_member_id") REFERENCES "project_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "plans"
  ADD CONSTRAINT "fk_plans_approver_member_id"
  FOREIGN KEY ("approver_member_id") REFERENCES "project_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "plans"
  ADD CONSTRAINT "fk_plans_progress_manager_member_id"
  FOREIGN KEY ("progress_manager_member_id") REFERENCES "project_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
