-- =============================================================================
-- Migration: 20260901000001_add_organizations
-- Phase 0.5 (有料プラン): 課金の契約主体となる組織と、会員アカウント(座席)を追加する。
-- 設計書: docs/design/02-database.md §2.4.10 / §2.4.11、07-billing.md §7.3
--
-- 【実データ影響（精査済み・破壊的操作なし）】
--   - 追加のみ。既存テーブルの列・制約・データは一切変更しない。
--   - 既存の全ユーザー (deleted_at が入った退会済みも含む) に対して個人組織を
--     backfill する。退会済みを除外すると projects.organization_id の NOT NULL 化
--     (次のマイグレーション) で NULL が残り失敗するため、意図的に全件を対象とする。
--   - organizations に plan_code は持たせない。契約情報の唯一の正は
--     billing_subscriptions とし、二重管理を作らない (設計書 §7.13 論点 2)。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CreateTable: organizations
-- -----------------------------------------------------------------------------
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_orgs_name_length" CHECK (char_length("name") BETWEEN 1 AND 255)
);

COMMENT ON TABLE "organizations" IS '組織 (課金の契約主体)。ユーザー登録時に個人組織を自動作成する';
COMMENT ON COLUMN "organizations"."owner_user_id" IS 'オーナー。1 ユーザーにつきオーナー組織は 1 つ';

ALTER TABLE "organizations"
  ADD CONSTRAINT "fk_orgs_owner_user_id" FOREIGN KEY ("owner_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_orgs_owner_user_id" ON "organizations"("owner_user_id");

CREATE TRIGGER trg_organizations_set_updated_at
  BEFORE UPDATE ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION trakon_set_updated_at();

-- -----------------------------------------------------------------------------
-- CreateTable: organization_members (= 会員アカウント。課金の人数カウント対象)
--
-- project_members との違い:
--   organization_members … user_id NOT NULL / 座席を消費する / 課金操作の権限
--   project_members      … user_id NULL 可   / 座席を消費しない / 業務操作の権限
-- -----------------------------------------------------------------------------
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_role" TEXT NOT NULL DEFAULT 'member',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_om_org_role" CHECK ("org_role" IN ('owner', 'admin', 'member'))
);

COMMENT ON TABLE "organization_members" IS '会員アカウント (座席)。課金の人数カウント対象';
COMMENT ON COLUMN "organization_members"."is_primary" IS '既定の所属組織。プロジェクト作成先の決定に使う';

ALTER TABLE "organization_members"
  ADD CONSTRAINT "fk_om_organization_id" FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_members"
  ADD CONSTRAINT "fk_om_user_id" FOREIGN KEY ("user_id")
  REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 論理削除を含むフル UNIQUE。再招待時は既存行を復活させる (uq_pm_project_email と同じ流儀)
CREATE UNIQUE INDEX "uq_om_org_user" ON "organization_members"("organization_id", "user_id");

-- 既定の所属組織は 1 ユーザーにつき 1 つ (部分 UNIQUE)
CREATE UNIQUE INDEX "uq_om_user_primary" ON "organization_members"("user_id")
  WHERE "is_primary" AND "deleted_at" IS NULL;

CREATE INDEX "idx_om_user" ON "organization_members"("user_id");
CREATE INDEX "idx_om_org_active" ON "organization_members"("organization_id")
  WHERE "deleted_at" IS NULL;

CREATE TRIGGER trg_organization_members_set_updated_at
  BEFORE UPDATE ON "organization_members"
  FOR EACH ROW EXECUTE FUNCTION trakon_set_updated_at();

-- -----------------------------------------------------------------------------
-- Backfill: 全ユーザーに個人組織を作成する
--
-- 退会済み (deleted_at IS NOT NULL) も対象にする。そのユーザーが作成した
-- プロジェクトが残っている可能性があり、除外すると次のマイグレーションで
-- projects.organization_id に NULL が残って NOT NULL 化に失敗するため。
-- -----------------------------------------------------------------------------
INSERT INTO "organizations" ("name", "owner_user_id", "created_at", "updated_at")
SELECT
  left(u."display_name", 240) || ' の組織',
  u."id",
  u."created_at",
  u."created_at"
FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."owner_user_id" = u."id");

INSERT INTO "organization_members"
  ("organization_id", "user_id", "org_role", "is_primary", "joined_at", "created_at", "updated_at")
SELECT o."id", o."owner_user_id", 'owner', true, o."created_at", o."created_at", o."created_at"
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "organization_members" m
  WHERE m."organization_id" = o."id" AND m."user_id" = o."owner_user_id"
);
