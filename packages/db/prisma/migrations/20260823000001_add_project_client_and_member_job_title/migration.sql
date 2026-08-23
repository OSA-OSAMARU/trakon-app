-- #147 プロジェクトのクライアント名と、参加者の職種・区分を追加する。
--
-- いずれも表示用の項目で、認可やボールの状態機械には影響しない。
-- 既存行は client_name / job_title とも NULL のまま (どちらも任意項目)。

-- 1) プロジェクトのクライアント名
ALTER TABLE "projects" ADD COLUMN "client_name" TEXT;

-- 2) 参加者の職種 (Figma の職種マスタ 18 種)
ALTER TABLE "project_members" ADD COLUMN "job_title" TEXT;

ALTER TABLE "project_members"
  ADD CONSTRAINT "ck_pm_job_title" CHECK (
    "job_title" IS NULL OR "job_title" IN (
      'producer', 'planner', 'project_manager', 'director', 'art_director',
      'technical_director', 'designer', 'web_designer', 'ui_ux_designer',
      'engineer', 'frontend_engineer', 'backend_engineer', 'coder', 'writer',
      'photographer', 'marketer', 'account', 'other'
    )
  );

-- 3) 区分に 'partner' (外部パートナー) を追加。
--    既存の 'client' / 'production' はそのまま有効なのでデータ移行は不要。
ALTER TABLE "project_members" DROP CONSTRAINT "ck_pm_member_type";

ALTER TABLE "project_members"
  ADD CONSTRAINT "ck_pm_member_type" CHECK ("member_type" IN ('client', 'production', 'partner'));
