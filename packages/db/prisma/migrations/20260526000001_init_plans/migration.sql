-- =============================================================================
-- Migration: 20260526000001_init_plans
-- Sub-Phase 0.3: plans / ball_events
-- 設計書: docs/design/02-database.md §2.4.5, §2.4.6, §2.6
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CreateTable: plans
-- -----------------------------------------------------------------------------
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "item_id" UUID NOT NULL,
    "plan_type" TEXT NOT NULL DEFAULT 'toss',
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "due_date" DATE,
    "from_member_id" UUID,
    "to_member_id" UUID,
    "successor_plan_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "memo" TEXT,
    "completed_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_plans_plan_type" CHECK ("plan_type" IN ('toss')),
    CONSTRAINT "ck_plans_category" CHECK ("category" IN (
        'wireframe', 'design', 'coding', 'review', 'meeting', 'other'
    )),
    CONSTRAINT "ck_plans_status" CHECK ("status" IN ('active', 'completed', 'canceled')),
    CONSTRAINT "ck_plans_title_length" CHECK (char_length("title") BETWEEN 1 AND 255),
    CONSTRAINT "ck_plans_no_self_successor" CHECK (
        "successor_plan_id" IS NULL OR "successor_plan_id" <> "id"
    ),
    CONSTRAINT "ck_plans_due_date_range" CHECK (
        "due_date" IS NULL OR "due_date" >= "scheduled_date"
    ),
    CONSTRAINT "ck_plans_toss_members" CHECK (
        "plan_type" <> 'toss'
        OR ("from_member_id" IS NOT NULL
            AND "to_member_id" IS NOT NULL
            AND "from_member_id" <> "to_member_id")
    )
);

COMMENT ON TABLE "plans" IS '予定 (Phase 0 は plan_type=toss のみ)';
COMMENT ON COLUMN "plans"."successor_plan_id" IS '完了時に自動 TOSS される後続予定 (UNIQUE, 自己参照禁止)';

-- -----------------------------------------------------------------------------
-- CreateTable: ball_events  (append-only)
-- -----------------------------------------------------------------------------
CREATE TABLE "ball_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "plan_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'human',
    "actor_member_id" UUID,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "ball_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_be_event_type" CHECK ("event_type" IN ('tossed', 'completed')),
    CONSTRAINT "ck_be_source" CHECK ("source" IN ('human', 'auto_chain')),
    -- human のときは actor 両方 NOT NULL、auto_chain のときは両方 NULL
    CONSTRAINT "ck_be_actor_consistency" CHECK (
        ("source" = 'human'
         AND "actor_member_id" IS NOT NULL
         AND "actor_user_id" IS NOT NULL)
        OR
        ("source" = 'auto_chain'
         AND "actor_member_id" IS NULL
         AND "actor_user_id" IS NULL)
    )
);

COMMENT ON TABLE "ball_events" IS 'ボール責任移動履歴 (append-only)';

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX "uq_plans_successor_plan_id" ON "plans"("successor_plan_id");
CREATE INDEX "idx_plans_item_scheduled" ON "plans"("item_id", "scheduled_date");
CREATE INDEX "idx_plans_from_member" ON "plans"("from_member_id");
CREATE INDEX "idx_plans_to_member" ON "plans"("to_member_id");
CREATE INDEX "idx_plans_category" ON "plans"("category");
CREATE INDEX "idx_plans_status_scheduled" ON "plans"("status", "scheduled_date");

CREATE INDEX "idx_be_plan_occurred_desc" ON "ball_events"("plan_id", "occurred_at" DESC);
CREATE INDEX "idx_be_source" ON "ball_events"("source");

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE "plans"
  ADD CONSTRAINT "fk_plans_item_id"
  FOREIGN KEY ("item_id") REFERENCES "project_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plans"
  ADD CONSTRAINT "fk_plans_from_member_id"
  FOREIGN KEY ("from_member_id") REFERENCES "project_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "plans"
  ADD CONSTRAINT "fk_plans_to_member_id"
  FOREIGN KEY ("to_member_id") REFERENCES "project_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "plans"
  ADD CONSTRAINT "fk_plans_successor_plan_id"
  FOREIGN KEY ("successor_plan_id") REFERENCES "plans"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ball_events"
  ADD CONSTRAINT "fk_be_plan_id"
  FOREIGN KEY ("plan_id") REFERENCES "plans"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ball_events"
  ADD CONSTRAINT "fk_be_actor_member_id"
  FOREIGN KEY ("actor_member_id") REFERENCES "project_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ball_events"
  ADD CONSTRAINT "fk_be_actor_user_id"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Triggers
-- (関数 trakon_set_updated_at / trakon_reject_mutation は init_auth で作成済み)
-- -----------------------------------------------------------------------------

-- plans.updated_at 自動更新
CREATE TRIGGER trg_plans_set_updated_at
  BEFORE UPDATE ON "plans"
  FOR EACH ROW EXECUTE FUNCTION trakon_set_updated_at();

-- ball_events append-only 強制 (UPDATE/DELETE 拒否)
CREATE TRIGGER trg_ball_events_no_update
  BEFORE UPDATE ON "ball_events"
  FOR EACH ROW EXECUTE FUNCTION trakon_reject_mutation();

CREATE TRIGGER trg_ball_events_no_delete
  BEFORE DELETE ON "ball_events"
  FOR EACH ROW EXECUTE FUNCTION trakon_reject_mutation();
