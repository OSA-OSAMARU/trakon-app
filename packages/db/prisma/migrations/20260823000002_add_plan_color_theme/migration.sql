-- #149 予定ごとのカラーテーマを追加する。
--
-- Figma のパレット (node 54:2) は「色は状態ではなく、ユーザーがスケジュールを
-- 視覚整理するために使用する」と定めている。これまではカテゴリから自動導出して
-- いたが、予定ごとにユーザーが選べるようにする。
--
-- NULL はカテゴリ由来の既定色にフォールバックするため、既存行の移行は不要。

ALTER TABLE "plans" ADD COLUMN "color_theme" TEXT;

ALTER TABLE "plans"
  ADD CONSTRAINT "ck_plans_color_theme" CHECK (
    "color_theme" IS NULL OR "color_theme" IN (
      'warm-gray', 'rose', 'coral', 'amber', 'lime',
      'green', 'teal', 'cyan', 'blue', 'violet'
    )
  );
