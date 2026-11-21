-- -----------------------------------------------------------------------------
-- Migration: 20261121000001_add_mcp_oauth
-- AI 連携 (MCP サーバ) の OAuth 2.1 認可を追加する。設計書: docs/design/08-mcp.md §8.6
--
-- 目的:
--   Claude / ChatGPT / Gemini / Copilot などの AI クライアントが、利用者の同意を得て
--   TRAKON の予定を読み書きできるようにする。TRAKON 自身が OAuth 2.1 認可サーバになり、
--   動的クライアント登録 (RFC 7591) + PKCE + 不透明トークンで認可する。
--
-- 設計判断:
--   * 既存の oauth_identities (Google / Microsoft ログイン) と混同しないよう mcp_ 接頭辞。
--   * 認可コード・アクセストークン・リフレッシュトークンは **SHA-256 のみ保存**。
--     DB 単体が漏れてもトークンとしては使えない。
--   * ユーザー削除 (物理) 時は接続ごと消す (ON DELETE CASCADE)。退会 (論理削除) の
--     ユーザーはアプリ側でトークンを拒否する。
--
-- 実データ影響: 新規テーブルの追加と audit_logs.action 許可値の追加 (スーパーセット) のみ。
-- -----------------------------------------------------------------------------

CREATE TABLE "mcp_clients" (
  "id"            UUID PRIMARY KEY,
  "client_name"   TEXT NOT NULL,
  "redirect_uris" TEXT[] NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "ck_mc_client_name_length" CHECK (char_length("client_name") BETWEEN 1 AND 100),
  CONSTRAINT "ck_mc_redirect_uris_count" CHECK (cardinality("redirect_uris") BETWEEN 1 AND 10)
);

COMMENT ON TABLE "mcp_clients" IS
  'AI 連携: 動的登録された OAuth クライアント。id が client_id。名称は自己申告で信用しない';

CREATE TABLE "mcp_authorization_codes" (
  "id"             UUID PRIMARY KEY,
  "code_hash"      TEXT NOT NULL,
  "client_id"      UUID NOT NULL,
  "user_id"        UUID NOT NULL,
  "redirect_uri"   TEXT NOT NULL,
  "code_challenge" TEXT NOT NULL,
  "scope"          TEXT NOT NULL,
  "resource"       TEXT NOT NULL,
  "expires_at"     TIMESTAMPTZ NOT NULL,
  "consumed_at"    TIMESTAMPTZ,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "uq_mac_code_hash" UNIQUE ("code_hash"),
  CONSTRAINT "fk_mac_client_id"
    FOREIGN KEY ("client_id") REFERENCES "mcp_clients"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_mac_user_id"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

COMMENT ON TABLE "mcp_authorization_codes" IS
  'AI 連携: OAuth 認可コード (10 分・1 回限り)。code_hash は SHA-256';

CREATE INDEX "idx_mac_user_id" ON "mcp_authorization_codes"("user_id");

CREATE TABLE "mcp_grants" (
  "id"                       UUID PRIMARY KEY,
  "client_id"                UUID NOT NULL,
  "user_id"                  UUID NOT NULL,
  "scope"                    TEXT NOT NULL,
  "resource"                 TEXT NOT NULL,
  "access_token_hash"        TEXT NOT NULL,
  "access_token_expires_at"  TIMESTAMPTZ NOT NULL,
  "refresh_token_hash"       TEXT NOT NULL,
  "refresh_token_expires_at" TIMESTAMPTZ NOT NULL,
  "last_used_at"             TIMESTAMPTZ,
  "revoked_at"               TIMESTAMPTZ,
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "uq_mg_access_token_hash" UNIQUE ("access_token_hash"),
  CONSTRAINT "uq_mg_refresh_token_hash" UNIQUE ("refresh_token_hash"),
  CONSTRAINT "fk_mg_client_id"
    FOREIGN KEY ("client_id") REFERENCES "mcp_clients"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_mg_user_id"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

COMMENT ON TABLE "mcp_grants" IS
  'AI 連携: 接続 (同意 1 回 = 1 行)。現在有効なトークンのハッシュを持ち、ローテーションで差し替える';

CREATE INDEX "idx_mg_user_id_created_at" ON "mcp_grants"("user_id", "created_at" DESC);

-- 監査ログ: AI 連携の接続 / 接続解除
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
    'share_complete',
    'share_request_review',
    'share_approve',
    'share_send_back',
    -- 課金系 (Phase 0.5)
    'checkout_started',
    'trial_started',
    'trial_blocked',
    'trial_released',
    'subscription_created',
    'subscription_updated',
    'subscription_canceled',
    'subscription_reconciled',
    'plan_changed',
    'payment_failed',
    'payment_recovered',
    -- 組織・ロール系 (Phase 0.5)
    'org_member_added',
    'org_member_removed',
    'org_role_changed',
    'invitation_created',
    'invitation_revoked',
    'project_role_changed',
    'retained_projects_changed',
    -- AI 連携 (08-mcp §8.6)
    'mcp_connected',
    'mcp_revoked'
  ));
