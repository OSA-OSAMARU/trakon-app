-- =============================================================================
-- Migration: 20260901000004_add_billing_tables
-- Phase 0.5 (有料プラン): 契約状態・Webhook 受信台帳・トライアル利用履歴を追加する。
-- 設計書: docs/design/02-database.md §2.4.12〜§2.4.14、07-billing.md §7.5 / §7.9
--
-- 【実データ影響（精査済み・破壊的操作なし）】
--   - 追加のみ。既存テーブルは変更しない。
--   - 既存の全組織に free の billing_subscriptions 行を backfill する
--     (組織と 1:1。行が無い状態を作らず、判定側の分岐を減らす)。
--   - stripe_events には audit_logs のような append-only トリガを付けない。
--     processed_at / status を後から更新するため。
--   - カードの識別子(fingerprint)は保存しない。法人カードの共有による誤判定が
--     あり得るため識別子のみを根拠に自動拒否してはならないという要件を、
--     そもそも保存しないことで担保する (設計書 §7.9.2)。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CreateTable: billing_subscriptions (組織と 1:1)
-- -----------------------------------------------------------------------------
CREATE TABLE "billing_subscriptions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "plan_code" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'none',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "stripe_price_id" TEXT,
    "current_period_start" TIMESTAMPTZ,
    "current_period_end" TIMESTAMPTZ,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ,
    "trial_start" TIMESTAMPTZ,
    "trial_end" TIMESTAMPTZ,
    "trial_used_at" TIMESTAMPTZ,
    "latest_invoice_id" TEXT,
    "last_payment_failed_at" TIMESTAMPTZ,
    "grace_period_ends_at" TIMESTAMPTZ,
    "pending_plan_code" TEXT,
    "pending_plan_effective_at" TIMESTAMPTZ,
    "default_payment_method_brand" TEXT,
    "default_payment_method_last4" TEXT,
    "last_stripe_event_id" TEXT,
    "last_stripe_event_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_bs_plan_code" CHECK ("plan_code" IN ('free', 'personal', 'team', 'enterprise')),
    CONSTRAINT "ck_bs_pending_plan_code" CHECK (
      "pending_plan_code" IS NULL
      OR "pending_plan_code" IN ('free', 'personal', 'team', 'enterprise')
    ),
    CONSTRAINT "ck_bs_status" CHECK ("status" IN (
      'none', 'trialing', 'active', 'past_due', 'unpaid',
      'canceled', 'incomplete', 'incomplete_expired', 'paused'
    ))
);

COMMENT ON TABLE "billing_subscriptions" IS
  '契約・課金状態。Stripe Webhook を正として更新し、これを唯一の権限判定材料とする';
COMMENT ON COLUMN "billing_subscriptions"."grace_period_ends_at" IS
  '支払猶予期限 (初回失敗 + 7日)。再試行のたびに延ばさない';
COMMENT ON COLUMN "billing_subscriptions"."pending_plan_code" IS
  '保留中のプラン変更。追加請求の決済成功を確認するまで plan_code は昇格させない';
COMMENT ON COLUMN "billing_subscriptions"."default_payment_method_last4" IS
  '表示専用。カード番号・識別子(fingerprint)は保持しない';

ALTER TABLE "billing_subscriptions"
  ADD CONSTRAINT "fk_bs_organization_id" FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_bs_organization_id" ON "billing_subscriptions"("organization_id");
CREATE UNIQUE INDEX "uq_bs_stripe_customer_id" ON "billing_subscriptions"("stripe_customer_id");
CREATE UNIQUE INDEX "uq_bs_stripe_subscription_id" ON "billing_subscriptions"("stripe_subscription_id");
CREATE INDEX "idx_bs_status" ON "billing_subscriptions"("status");
CREATE INDEX "idx_bs_grace" ON "billing_subscriptions"("grace_period_ends_at")
  WHERE "grace_period_ends_at" IS NOT NULL;

CREATE TRIGGER trg_billing_subscriptions_set_updated_at
  BEFORE UPDATE ON "billing_subscriptions"
  FOR EACH ROW EXECUTE FUNCTION trakon_set_updated_at();

-- -----------------------------------------------------------------------------
-- CreateTable: stripe_events (Webhook の冪等性・順序逆転耐性)
-- -----------------------------------------------------------------------------
CREATE TABLE "stripe_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "stripe_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_created_at" TIMESTAMPTZ NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'received',
    "organization_id" UUID,
    "error" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_se_status" CHECK ("status" IN ('received', 'processed', 'skipped', 'failed'))
);

COMMENT ON TABLE "stripe_events" IS 'Webhook 受信台帳。event_id の一意制約で二重処理を防ぐ';
COMMENT ON COLUMN "stripe_events"."event_created_at" IS
  'Stripe 側の発生時刻。秒精度のため順序判定には使わず、契約系は API から現在値を取り直す';

ALTER TABLE "stripe_events"
  ADD CONSTRAINT "fk_se_organization_id" FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_se_event_id" ON "stripe_events"("stripe_event_id");
CREATE INDEX "idx_se_type_created" ON "stripe_events"("event_type", "event_created_at" DESC);

-- -----------------------------------------------------------------------------
-- CreateTable: billing_trial_claims (トライアル重複防止)
-- -----------------------------------------------------------------------------
CREATE TABLE "billing_trial_claims" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID,
    "user_id" UUID,
    "email_normalized" TEXT NOT NULL,
    "email_domain" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ,
    "released_reason" TEXT,
    "released_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_trial_claims_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "billing_trial_claims" IS
  'トライアル利用履歴。誤判定に備え運用手順で手動解除できる (行は削除せず released_* を埋める)';
COMMENT ON COLUMN "billing_trial_claims"."email_domain" IS
  'ドメイン一致は記録のみ。自動拒否には使わない';

ALTER TABLE "billing_trial_claims"
  ADD CONSTRAINT "fk_btc_organization_id" FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_trial_claims"
  ADD CONSTRAINT "fk_btc_user_id" FOREIGN KEY ("user_id")
  REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 未解除のものだけを一意にする (解除すると再度トライアルできる)
CREATE UNIQUE INDEX "uq_btc_email_active" ON "billing_trial_claims"("email_normalized")
  WHERE "released_at" IS NULL;
CREATE UNIQUE INDEX "uq_btc_user_active" ON "billing_trial_claims"("user_id")
  WHERE "released_at" IS NULL AND "user_id" IS NOT NULL;

CREATE INDEX "idx_btc_domain" ON "billing_trial_claims"("email_domain");
CREATE INDEX "idx_btc_customer" ON "billing_trial_claims"("stripe_customer_id");

-- -----------------------------------------------------------------------------
-- Backfill: 全組織に free の契約行を作る
-- -----------------------------------------------------------------------------
INSERT INTO "billing_subscriptions" ("organization_id", "plan_code", "status", "created_at", "updated_at")
SELECT o."id", 'free', 'none', o."created_at", o."created_at"
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "billing_subscriptions" b WHERE b."organization_id" = o."id"
);
