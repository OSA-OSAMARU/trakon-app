-- =============================================================================
-- Migration: 20260524000001_init_auth
-- Sub-Phase 0.1: users / oauth_identities / audit_logs
-- 設計書: docs/design/02-database.md §2.4.1, §2.4.X, §2.4.7
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

-- uuidv7() — Postgres native UUID v7 generator
-- ref: https://www.ietf.org/archive/id/draft-ietf-uuidrev-rfc4122bis-14.html#name-uuid-version-7
-- 実装: time-ordered 48bit unix_ms + 4bit version + 12bit rand_a + 2bit variant + 62bit rand_b
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  buffer bytea;
BEGIN
  unix_ts_ms := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  -- ランダム 10 byte
  buffer := unix_ts_ms || gen_random_bytes(10);
  -- version = 7 (上位 4bit を 0111 に)
  buffer := set_byte(buffer, 6, (b'01110000'::bit(8) | get_byte(buffer, 6)::bit(8) & b'00001111'::bit(8))::int);
  -- variant = 10 (上位 2bit を 10 に)
  buffer := set_byte(buffer, 8, (b'10000000'::bit(8) | get_byte(buffer, 8)::bit(8) & b'00111111'::bit(8))::int);
  RETURN encode(buffer, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;

-- pgcrypto を有効化（gen_random_bytes / gen_random_uuid 用）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- updated_at 自動更新トリガ関数
CREATE OR REPLACE FUNCTION trakon_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- audit_logs append-only 強制トリガ関数 (UPDATE/DELETE を拒否)
CREATE OR REPLACE FUNCTION trakon_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is forbidden (append-only table)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- CreateTable: users
-- -----------------------------------------------------------------------------
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "auth_user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "primary_auth_method" TEXT NOT NULL DEFAULT 'password',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_users_primary_auth_method" CHECK ("primary_auth_method" IN ('password', 'google', 'microsoft')),
    CONSTRAINT "ck_users_full_name_length" CHECK (char_length("full_name") BETWEEN 1 AND 100),
    CONSTRAINT "ck_users_display_name_length" CHECK (char_length("display_name") BETWEEN 1 AND 50)
);

COMMENT ON TABLE "users" IS 'アプリ側ユーザー本体 (Supabase auth.users と 1:1)';
COMMENT ON COLUMN "users"."primary_auth_method" IS '同一メール1認証手段制約のためのプライマリ認証方式 (FR-AUTH-12)';

-- -----------------------------------------------------------------------------
-- CreateTable: oauth_identities
-- -----------------------------------------------------------------------------
CREATE TABLE "oauth_identities" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_identities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_oauth_identities_provider" CHECK ("provider" IN ('google', 'microsoft'))
);

COMMENT ON TABLE "oauth_identities" IS 'OAuth 連携 identity (v1.1, Phase 0)';

-- -----------------------------------------------------------------------------
-- CreateTable: audit_logs
-- -----------------------------------------------------------------------------
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "share_link_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "result" TEXT NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_al_result" CHECK ("result" IN ('success', 'failure')),
    CONSTRAINT "ck_al_action" CHECK ("action" IN (
        'login',
        'logout',
        'complete_signup',
        'toss',
        'complete',
        'auto_toss',
        'share_access',
        'share_create',
        'share_revoke',
        'share_toss',
        'share_complete'
    ))
);

COMMENT ON TABLE "audit_logs" IS '監査ログ (append-only) — UPDATE/DELETE はトリガで拒否';

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX "uq_users_auth_user_id" ON "users"("auth_user_id");
-- email は論理削除を考慮した部分ユニーク (設計書 §2.4.1)
CREATE UNIQUE INDEX "uq_users_email" ON "users"("email") WHERE "deleted_at" IS NULL;
CREATE INDEX "idx_users_auth_user_id" ON "users"("auth_user_id");

CREATE INDEX "idx_oauth_identities_user_id" ON "oauth_identities"("user_id");
CREATE UNIQUE INDEX "uq_oauth_identities_provider_provider_user_id" ON "oauth_identities"("provider", "provider_user_id");
CREATE UNIQUE INDEX "uq_oauth_identities_user_id_provider" ON "oauth_identities"("user_id", "provider");

CREATE INDEX "idx_al_occurred_at_desc" ON "audit_logs"("occurred_at" DESC);
CREATE INDEX "idx_al_actor_user_id_occurred_at" ON "audit_logs"("actor_user_id", "occurred_at" DESC);
CREATE INDEX "idx_al_resource" ON "audit_logs"("resource_type", "resource_id");
-- 長期履歴用 BRIN (設計書 §2.4.7)
CREATE INDEX "brin_al_occurred_at" ON "audit_logs" USING brin ("occurred_at");

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE "oauth_identities"
  ADD CONSTRAINT "fk_oauth_identities_user_id"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "fk_al_actor_user_id"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

-- users.updated_at 自動更新
CREATE TRIGGER trg_users_set_updated_at
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION trakon_set_updated_at();

-- oauth_identities.updated_at 自動更新
CREATE TRIGGER trg_oauth_identities_set_updated_at
  BEFORE UPDATE ON "oauth_identities"
  FOR EACH ROW EXECUTE FUNCTION trakon_set_updated_at();

-- audit_logs append-only 強制 (UPDATE/DELETE 拒否)
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION trakon_reject_mutation();

CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION trakon_reject_mutation();
