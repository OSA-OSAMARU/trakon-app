-- =============================================================================
-- Migration: 20260901000002_projects_organization_not_null
-- Phase 0.5 (有料プラン): projects を組織に所属させ、プロジェクト数上限の
-- 判定単位を確定する。あわせて上限超過時の「維持指定」列を追加する。
-- 設計書: docs/design/02-database.md §2.2.6 / §2.4.2、07-billing.md §7.11
--
-- 【実データ影響（精査済み・破壊的操作あり）】
--   - projects.organization_id を作成者の個人組織で backfill してから NOT NULL 化する。
--     SET NOT NULL は ACCESS EXCLUSIVE ロック + 全表スキャンを伴う。
--   - backfill が 1 行でも漏れると SET NOT NULL が失敗して全体がロールバックする
--     （＝安全側に倒れる）。20260901000001_add_organizations の先行適用が必須。
--   - FK は ON DELETE RESTRICT。組織の削除でプロジェクトが道連れに消えないことを
--     DB レベルで保証する（FR-BILL-09「解約時にプロジェクトを削除しない」の裏付け）。
--   - retained_at は既存行すべて NULL のまま（未指定＝作成が古い順に維持）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) backfill: 作成者の個人組織へ割り当てる
-- -----------------------------------------------------------------------------
UPDATE "projects" p
SET "organization_id" = o."id"
FROM "organizations" o
WHERE p."organization_id" IS NULL
  AND o."owner_user_id" = p."created_by";

-- -----------------------------------------------------------------------------
-- 2) FK と NOT NULL 化
-- -----------------------------------------------------------------------------
ALTER TABLE "projects"
  ADD CONSTRAINT "fk_projects_organization_id" FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "projects" ALTER COLUMN "organization_id" SET NOT NULL;

COMMENT ON COLUMN "projects"."organization_id" IS '所属組織。プロジェクト数上限の判定単位';

-- -----------------------------------------------------------------------------
-- 3) 上限超過時に「維持する」と選ばれた日時
--    凍結状態そのものは保存せず都度計算する。ユーザーの選択だけを永続化する。
-- -----------------------------------------------------------------------------
ALTER TABLE "projects" ADD COLUMN "retained_at" TIMESTAMPTZ;

COMMENT ON COLUMN "projects"."retained_at" IS
  '上限超過時に維持対象として選択された日時。未指定なら作成が古い順に維持される';

-- -----------------------------------------------------------------------------
-- 4) プロジェクト数上限の判定に使う部分インデックス
--    アーカイブ済みはカウント対象外（＝枠を空ける正規の動線）
-- -----------------------------------------------------------------------------
CREATE INDEX "idx_projects_org_active" ON "projects"("organization_id")
  WHERE "deleted_at" IS NULL AND "archived_at" IS NULL;
