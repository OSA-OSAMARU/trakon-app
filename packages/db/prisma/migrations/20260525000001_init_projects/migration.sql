-- =============================================================================
-- Migration: 20260525000001_init_projects
-- Sub-Phase 0.2: projects / project_members / project_items / invitations
-- 設計書: docs/design/02-database.md §2.4.2, §2.4.3, §2.4.4, §2.4.8
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CreateTable: projects
-- -----------------------------------------------------------------------------
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ,
    "archived_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_projects_status" CHECK ("status" IN ('active', 'closed')),
    CONSTRAINT "ck_projects_date_range" CHECK ("end_date" >= "start_date"),
    CONSTRAINT "ck_projects_name_length" CHECK (char_length("name") BETWEEN 1 AND 255)
);

COMMENT ON TABLE "projects" IS 'プロジェクト本体';
COMMENT ON COLUMN "projects"."organization_id" IS 'Phase 2 で NOT NULL 化、組織レベル統制で利用';

-- -----------------------------------------------------------------------------
-- CreateTable: project_members
-- -----------------------------------------------------------------------------
CREATE TABLE "project_members" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "project_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization_name" TEXT NOT NULL,
    "member_type" TEXT NOT NULL,
    "role_type" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_pm_member_type" CHECK ("member_type" IN ('client', 'production')),
    CONSTRAINT "ck_pm_name_length" CHECK (char_length("name") BETWEEN 1 AND 100),
    CONSTRAINT "ck_pm_email_length" CHECK (char_length("email") BETWEEN 1 AND 320),
    CONSTRAINT "ck_pm_organization_name_length" CHECK (char_length("organization_name") BETWEEN 0 AND 255)
);

COMMENT ON TABLE "project_members" IS 'プロジェクト参加者 (招待受諾前は user_id NULL)';

-- -----------------------------------------------------------------------------
-- CreateTable: project_items
-- -----------------------------------------------------------------------------
CREATE TABLE "project_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "item_type" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "start_date" DATE,
    "end_date" DATE,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_pi_name_length" CHECK (char_length("name") BETWEEN 1 AND 255),
    CONSTRAINT "ck_pi_date_range" CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date")
);

COMMENT ON TABLE "project_items" IS '制作物 (各プロジェクト最低1件)';

-- -----------------------------------------------------------------------------
-- CreateTable: invitations
-- -----------------------------------------------------------------------------
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "project_id" UUID NOT NULL,
    "invited_member_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role_type" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "invitations" IS '招待トークン (token_hash = SHA-256, 生トークン非保持, 72h)';

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX "idx_projects_organization_id" ON "projects"("organization_id");
CREATE INDEX "idx_projects_created_by_status" ON "projects"("created_by", "status");

CREATE UNIQUE INDEX "uq_pm_project_email" ON "project_members"("project_id", "email");
CREATE INDEX "idx_pm_project_sort" ON "project_members"("project_id", "sort_order");
CREATE INDEX "idx_pm_user_id" ON "project_members"("user_id");

CREATE INDEX "idx_pi_project_sort" ON "project_items"("project_id", "sort_order");

CREATE UNIQUE INDEX "uq_inv_token_hash" ON "invitations"("token_hash");
CREATE INDEX "idx_inv_project_id" ON "invitations"("project_id");
-- 有効な招待のみを高速検索するための部分インデックス (設計書 §2.4.8)
CREATE INDEX "idx_inv_email_active" ON "invitations"("email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL AND "expires_at" > now();

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE "projects"
  ADD CONSTRAINT "fk_projects_created_by"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_members"
  ADD CONSTRAINT "fk_pm_project_id"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_members"
  ADD CONSTRAINT "fk_pm_user_id"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_items"
  ADD CONSTRAINT "fk_pi_project_id"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitations"
  ADD CONSTRAINT "fk_inv_project_id"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitations"
  ADD CONSTRAINT "fk_inv_invited_member_id"
  FOREIGN KEY ("invited_member_id") REFERENCES "project_members"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Triggers (updated_at 自動更新)
-- 関数 trakon_set_updated_at() は init_auth migration で作成済み
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_projects_set_updated_at
  BEFORE UPDATE ON "projects"
  FOR EACH ROW EXECUTE FUNCTION trakon_set_updated_at();

CREATE TRIGGER trg_project_members_set_updated_at
  BEFORE UPDATE ON "project_members"
  FOR EACH ROW EXECUTE FUNCTION trakon_set_updated_at();

CREATE TRIGGER trg_project_items_set_updated_at
  BEFORE UPDATE ON "project_items"
  FOR EACH ROW EXECUTE FUNCTION trakon_set_updated_at();
