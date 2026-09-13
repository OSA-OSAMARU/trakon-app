-- -----------------------------------------------------------------------------
-- Migration: 20260913000002_add_user_profile_fields
-- issue #156「プランおよびマイページのデザイン組み込み」/ #157 / #159 / #160 の土台。
--
-- 目的:
--   マイページ (Figma node 254:2) が編集する「所属名 / 職種 / 通知先メール /
--   プロフィール画像」を users に持たせる。これまで所属名・職種は
--   project_members にしか無く、プロジェクトごとに入力し直す必要があった。
--
-- 方針 (read-through):
--   表示時の解決は「users を優先し、無ければ project_members の値」とする
--   (packages/shared/src/domain/memberProfile.ts)。
--   アカウント未紐付け (user_id IS NULL) の表示専用メンバーは users を持たないので、
--   これまでどおり project_members の値がそのまま使われる。
--
-- 実データ影響:
--   * 追加する 4 列はすべて nullable。既存行には NULL が入るだけ。
--   * notification_email は email でバックフィルしない。services/auth.ts の
--     reconcileEmailIfChanged() がログインメールを再同期するため、コピーは必ず陳腐化する。
--     NULL = 「ログイン用 email を使う」を意味する。
--   * (3) で user_id 付きの project_members の organization_name / job_title を空にする。
--     **値は (2) で users へ退避済み**。これを行わないと、既存ユーザーは全員
--     「プロジェクト別の上書きあり」の状態で固定され、マイページの編集が
--     既存プロジェクトに一切反映されなくなる。
--     user_id IS NULL の行 (表示専用メンバー) は対象外で、値はそのまま残る。
--   * 列の削除・行の削除は無い。
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 1. 列の追加 (nullable, 非破壊)
-- =============================================================================
ALTER TABLE "users"
  ADD COLUMN "organization_name"  TEXT,
  ADD COLUMN "job_title"          TEXT,
  ADD COLUMN "notification_email" TEXT,
  ADD COLUMN "avatar_path"        TEXT;

COMMENT ON COLUMN "users"."organization_name"  IS '所属名 (#156)。自由記述';
COMMENT ON COLUMN "users"."job_title"          IS '職種 (#156)。JOB_TITLES 18 値';
COMMENT ON COLUMN "users"."notification_email" IS '通知先メール (#156)。NULL はログイン用 email を使う';
COMMENT ON COLUMN "users"."avatar_path"        IS 'プロフィール画像 (#157)。Storage のオブジェクトキー';

-- job_title は project_members と同じ 18 値に揃える (ck_pm_job_title と同一)
ALTER TABLE "users"
  ADD CONSTRAINT "ck_users_job_title" CHECK (
    "job_title" IS NULL OR "job_title" IN (
      'producer', 'planner', 'project_manager', 'director', 'art_director',
      'technical_director', 'designer', 'web_designer', 'ui_ux_designer',
      'engineer', 'frontend_engineer', 'backend_engineer', 'coder', 'writer',
      'photographer', 'marketer', 'account', 'other'
    )
  );

-- =============================================================================
-- 2. 既存の参加者行から所属名 / 職種を users へ写す
--    (マイページが空欄で開かないようにする)
-- =============================================================================
-- updated_at を保持するため set_updated_at トリガを一時停止する
ALTER TABLE "users" DISABLE TRIGGER "trg_users_set_updated_at";

UPDATE "users" u
SET "organization_name" = s."organization_name",
    "job_title"         = s."job_title"
FROM (
  SELECT DISTINCT ON (pm."user_id")
         pm."user_id",
         NULLIF(pm."organization_name", '') AS "organization_name",
         pm."job_title"
  FROM "project_members" pm
  WHERE pm."user_id" IS NOT NULL
    AND pm."deleted_at" IS NULL
  ORDER BY pm."user_id", pm."created_at" DESC
) s
WHERE u."id" = s."user_id"
  AND u."deleted_at" IS NULL;

ALTER TABLE "users" ENABLE TRIGGER "trg_users_set_updated_at";

-- =============================================================================
-- 3. アカウント紐付け済みの参加者行から所属名 / 職種を落とす
--    (users を正にするため。値は 2 で退避済み)
-- =============================================================================
ALTER TABLE "project_members" DISABLE TRIGGER "trg_project_members_set_updated_at";

UPDATE "project_members"
SET "organization_name" = '',
    "job_title"         = NULL
WHERE "user_id" IS NOT NULL
  AND "deleted_at" IS NULL;

ALTER TABLE "project_members" ENABLE TRIGGER "trg_project_members_set_updated_at";

COMMENT ON COLUMN "project_members"."organization_name" IS
  '所属名。アカウント紐付け済みの参加者は users.organization_name が正で、この列は空 (#156)';
COMMENT ON COLUMN "project_members"."job_title" IS
  '職種。アカウント紐付け済みの参加者は users.job_title が正で、この列は NULL (#156)';
