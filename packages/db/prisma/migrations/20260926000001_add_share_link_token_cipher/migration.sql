-- 共有リンクの URL を発行後も再表示できるようにする (issue #255)
--
-- 生トークンは平文では持たず、アプリ側の鍵 (SHARE_TOKEN_ENCRYPTION_KEY) による
-- AES-256-GCM 暗号文を保管する。DB 単体が漏洩しても復号できない。
-- トークンの照合は従来どおり token_hash の完全一致で行い、この列は表示専用。
--
-- 既存行は NULL のまま。#255 以前に発行されたリンクは URL を再表示できないため、
-- 画面では「発行時のみ表示」の注意書きを出す。
ALTER TABLE "share_links" ADD COLUMN "token_cipher" text;

COMMENT ON COLUMN "share_links"."token_cipher" IS
  '生トークンの AES-256-GCM 暗号文 (v1:iv:ct:tag)。表示専用で認証には使わない (#255)';
