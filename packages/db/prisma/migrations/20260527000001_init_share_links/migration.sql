-- =============================================================================
-- Migration: 20260527000001_init_share_links
-- Sub-Phase 0.5: share_links + audit_logs.share_link_id の FK 追加
-- 設計書: docs/design/02-database.md §2.4.9, docs/design/05-security.md §5.6
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CreateTable: share_links
-- -----------------------------------------------------------------------------
CREATE TABLE "share_links" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "project_id" UUID NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_target_id" UUID,
    "token_hash" TEXT NOT NULL,
    "issued_by_member_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "last_accessed_at" TIMESTAMPTZ,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_sl_scope_type" CHECK ("scope_type" IN ('project', 'item', 'plan')),
    -- 'project' のときは scope_target_id NULL、'item'/'plan' のときは NOT NULL
    CONSTRAINT "ck_sl_scope_target" CHECK (
        ("scope_type" = 'project' AND "scope_target_id" IS NULL)
        OR
        ("scope_type" IN ('item', 'plan') AND "scope_target_id" IS NOT NULL)
    ),
    CONSTRAINT "ck_sl_expires_after_issued" CHECK ("expires_at" > "issued_at")
);

COMMENT ON TABLE "share_links" IS '非会員 URL 共有 (token_hash = SHA-256, scope は project/item/plan)';

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX "uq_sl_token_hash" ON "share_links"("token_hash");
CREATE INDEX "idx_sl_project_id" ON "share_links"("project_id");
-- 有効な共有のみを高速検索 (リンク受信時の検証用)
-- 注: expires_at > now() は now() が非 IMMUTABLE のため部分インデックス述語に置けない
--     (有効期限の判定はクエリ側で行う)。
CREATE INDEX "idx_sl_token_hash_active" ON "share_links"("token_hash")
  WHERE "revoked_at" IS NULL;

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE "share_links"
  ADD CONSTRAINT "fk_sl_project_id"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "share_links"
  ADD CONSTRAINT "fk_sl_issued_by_member_id"
  FOREIGN KEY ("issued_by_member_id") REFERENCES "project_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- audit_logs.share_link_id の FK を後付け (init_auth 時はカラムだけ作っていた)
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "fk_al_share_link_id"
  FOREIGN KEY ("share_link_id") REFERENCES "share_links"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
