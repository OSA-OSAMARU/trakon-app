-- -----------------------------------------------------------------------------
-- Migration: 20260913000003_org_member_default_role_and_org_invitations
-- issue #160「有料プランの場合の招待アカウント数管理」
--
-- 目的:
--   1. 組織メンバーに「既定のプロジェクト権限」を持たせる。
--      メンバー管理画面 (Figma node 406:22) の権限列がこの値で、
--      **座席 (課金枠) を消費するかの判定にも使う** (閲覧者は消費しない)。
--      認可の判定には使わない。判定は従来どおり project_members.role_type。
--   2. 招待をプロジェクト単位に限定せず、**組織単位でも発行できる**ようにする。
--      Figma の招待モーダル (node 409:22) にはプロジェクト選択が無く、
--      「組織に招く → 後からプロジェクトへ割り当てる」形になっている。
--
-- 実データ影響 (精査済み):
--   * default_project_role は NOT NULL DEFAULT 'editor' で追加したうえで、
--     既存メンバーはその組織のプロジェクトで持っている最上位のロール
--     (admin > editor > viewer) でバックフィルする。
--     これをしないと、既存の管理者・閲覧者が一律「編集者」に見えてしまう。
--   * invitations.project_id / invited_member_id を NULL 許容へ緩める。
--     既存行はすべて NOT NULL のまま残るので影響なし。
--     同時 NULL / 同時 NOT NULL を ck_inv_scope で保証する。
--   * 列の削除・行の削除は無い。
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 1. organization_members.default_project_role
-- =============================================================================
ALTER TABLE "organization_members"
  ADD COLUMN "default_project_role" TEXT NOT NULL DEFAULT 'editor';

ALTER TABLE "organization_members"
  ADD CONSTRAINT "ck_om_default_project_role"
  CHECK ("default_project_role" IN ('admin', 'editor', 'viewer'));

COMMENT ON COLUMN "organization_members"."default_project_role" IS
  '組織での既定のプロジェクト権限 (#160)。座席消費の判定とプロジェクト追加時の初期値に使う。認可判定には使わない';

-- 既存メンバーは、その組織のプロジェクトで持っている最上位のロールへ寄せる
ALTER TABLE "organization_members" DISABLE TRIGGER "trg_organization_members_set_updated_at";

UPDATE "organization_members" om
SET "default_project_role" = s."role"
FROM (
  SELECT pm."user_id",
         p."organization_id",
         CASE
           WHEN bool_or(pm."role_type" = 'admin')  THEN 'admin'
           WHEN bool_or(pm."role_type" = 'editor') THEN 'editor'
           ELSE 'viewer'
         END AS "role"
  FROM "project_members" pm
  JOIN "projects" p ON p."id" = pm."project_id"
  WHERE pm."user_id" IS NOT NULL
    AND pm."deleted_at" IS NULL
    AND p."deleted_at" IS NULL
  GROUP BY pm."user_id", p."organization_id"
) s
WHERE om."user_id" = s."user_id"
  AND om."organization_id" = s."organization_id"
  AND om."deleted_at" IS NULL;

-- オーナーは必ず管理者にする (自分の組織から締め出されないための最終防衛線)
UPDATE "organization_members"
SET "default_project_role" = 'admin'
WHERE "org_role" = 'owner'
  AND "default_project_role" <> 'admin';

ALTER TABLE "organization_members" ENABLE TRIGGER "trg_organization_members_set_updated_at";

-- 座席数の集計で毎回引くのでインデックスを張る
CREATE INDEX "idx_om_org_default_role"
  ON "organization_members"("organization_id", "default_project_role");

-- =============================================================================
-- 2. 組織単位の招待
-- =============================================================================
ALTER TABLE "invitations" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "invitations" ALTER COLUMN "invited_member_id" DROP NOT NULL;

-- プロジェクト単位の招待は両方セット、組織単位の招待は両方 NULL。
-- 片方だけの中途半端な行を作らせない。
ALTER TABLE "invitations"
  ADD CONSTRAINT "ck_inv_scope"
  CHECK (("project_id" IS NULL) = ("invited_member_id" IS NULL));

ALTER TABLE "invitations"
  ADD COLUMN "invited_name"      TEXT,
  ADD COLUMN "organization_name" TEXT,
  ADD COLUMN "job_title"         TEXT;

ALTER TABLE "invitations"
  ADD CONSTRAINT "ck_inv_job_title" CHECK (
    "job_title" IS NULL OR "job_title" IN (
      'producer', 'planner', 'project_manager', 'director', 'art_director',
      'technical_director', 'designer', 'web_designer', 'ui_ux_designer',
      'engineer', 'frontend_engineer', 'backend_engineer', 'coder', 'writer',
      'photographer', 'marketer', 'account', 'other'
    )
  );

COMMENT ON COLUMN "invitations"."project_id" IS
  'プロジェクト単位の招待の宛先。組織単位の招待では NULL (#160)';
COMMENT ON COLUMN "invitations"."invited_name" IS
  '招待時に入力した氏名 (#160)。受諾時に users が空なら引き継ぐ';

-- 保留中の招待は座席数の集計でロール別に数えるようになったので、
-- 既存の idx_inv_org_pending (organization_id のみ) を role_type 込みへ張り替える。
DROP INDEX IF EXISTS "idx_inv_org_pending";
CREATE INDEX "idx_inv_org_pending"
  ON "invitations"("organization_id", "role_type")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
