-- -----------------------------------------------------------------------------
-- Migration: 20260913000001_add_plan_category_proposal
-- issue #154「予定のカテゴリーに『提案』を追加する」
--
-- 目的:
--   plans.category の許可値に 'proposal' (提案) を追加し 7 値にする。
--   工程の流れ上、提案はワイヤーフレームの前に来る最初の工程にあたる。
--
-- 実データ影響 (精査済み・破壊的操作なし):
--   * CHECK 制約の許可値を「追加」する = 旧許可値のスーパーセットなので、
--     既存の全行がそのまま新制約を満たす。テーブル書き換え・行の更新は無い。
--   * 列の追加/削除、DELETE、既定値の変更は行わない。
-- -----------------------------------------------------------------------------

ALTER TABLE "plans" DROP CONSTRAINT "ck_plans_category";

ALTER TABLE "plans"
  ADD CONSTRAINT "ck_plans_category" CHECK ("category" IN (
    'proposal',
    'wireframe',
    'design',
    'coding',
    'review',
    'meeting',
    'other'
  ));

COMMENT ON COLUMN "plans"."category" IS
  '予定のカテゴリ (工程種別)。PLAN_CATEGORIES 7 値 (#154 で proposal を追加)';
