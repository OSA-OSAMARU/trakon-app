-- -----------------------------------------------------------------------------
-- Migration: 20260620000002_relax_plans_toss_members
-- ck_plans_toss_members を緩和し、実施者(FROM)/確認者(TO) 未設定の予定作成を許可する。
--  - 実施者/確認者は任意で後から設定できる仕様 (#55) に DB CHECK を合わせる。
--  - 旧 CHECK は plan_type='toss' のとき from/to を NOT NULL 必須としており、
--    {title, category, scheduledDate} のみの予定作成が CHECK 違反 (500) になっていた。
--  - 新 CHECK は「両方指定された場合のみ from <> to を強制」し、NULL は許容する。
-- -----------------------------------------------------------------------------

ALTER TABLE "plans" DROP CONSTRAINT "ck_plans_toss_members";

ALTER TABLE "plans" ADD CONSTRAINT "ck_plans_toss_members" CHECK (
    "from_member_id" IS NULL
    OR "to_member_id" IS NULL
    OR "from_member_id" <> "to_member_id"
);
