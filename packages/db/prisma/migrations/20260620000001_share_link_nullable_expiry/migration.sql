-- -----------------------------------------------------------------------------
-- Migration: 20260620000001_share_link_nullable_expiry
-- share_links.expires_at を NULL 許容にする (NULL = 無期限 / 有効期限なし)
--  - 共有リンク発行時に「有効期限を設定しない」選択を可能にする (#69)
--  - CHECK 制約 ck_sl_expires_after_issued ("expires_at" > "issued_at") は
--    NULL 比較が UNKNOWN → CHECK は FALSE でない限り通過するため変更不要。
-- -----------------------------------------------------------------------------

ALTER TABLE "share_links" ALTER COLUMN "expires_at" DROP NOT NULL;
