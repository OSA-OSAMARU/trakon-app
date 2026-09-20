-- -----------------------------------------------------------------------------
-- Migration: 20260920000001_add_plan_attachments
-- issue #65「TOSSと差戻しに対してコメントとファイルを添付できるようにしたい」
--
-- 目的:
--   予定 (plan) にファイルを添付できるようにする。PRD §8.2 の attachments 設計に沿う。
--   コメント部分は #206 で ball_events.note として実現済みなので、ここでは添付のみ。
--
-- 設計判断:
--   * **実体は DB に持たない。** Supabase Storage の非公開バケット `attachments` に置き、
--     配信は署名付き URL + 短時間有効期限で行う (PRD §8.2「直リンク禁止」)。
--     この表が持つのは storage_key と表示用のメタデータだけ。
--   * 論理削除 (deleted_at)。誤って消した直後に「戻せますか」と聞かれる余地を残す。
--     Storage 側の実体は削除時にまとめて消す (孤児を残さない)。
--   * uploader_member_id は ON DELETE RESTRICT。参加者を消しても
--     「誰が入れたファイルか」は残す (ball_events の actor と同じ扱い)。
--
-- 実データ影響: 新規テーブルのみ。既存テーブルの変更・削除は無い。
-- -----------------------------------------------------------------------------

CREATE TABLE "attachments" (
  "id"                 UUID PRIMARY KEY,
  "plan_id"            UUID NOT NULL,
  "uploader_member_id" UUID,
  -- Supabase Storage のオブジェクトキー。URL ではない (URL は都度署名して発行する)
  "storage_key"        TEXT NOT NULL,
  -- 表示・ダウンロード時のファイル名。利用者が付けた名前をそのまま残す
  "filename"           TEXT NOT NULL,
  "mime_type"          TEXT NOT NULL,
  "size_bytes"         INTEGER NOT NULL,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at"         TIMESTAMPTZ,

  CONSTRAINT "fk_att_plan_id"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_att_uploader_member_id"
    FOREIGN KEY ("uploader_member_id") REFERENCES "project_members"("id") ON DELETE RESTRICT,

  CONSTRAINT "ck_att_size_bytes" CHECK ("size_bytes" > 0),
  -- 同じオブジェクトを 2 行から指させない (削除時に実体が消せなくなるため)
  CONSTRAINT "uq_att_storage_key" UNIQUE ("storage_key")
);

COMMENT ON TABLE "attachments" IS
  '予定への添付ファイル (#65)。実体は Supabase Storage、この表はメタデータのみ';
COMMENT ON COLUMN "attachments"."storage_key" IS
  'Supabase Storage のオブジェクトキー。直リンクは禁止で、都度署名付き URL を発行する';
COMMENT ON COLUMN "attachments"."uploader_member_id" IS
  'アップロードした参加者。参加者削除でも残す (ON DELETE RESTRICT)';

-- 予定を開いたときに一覧するのが唯一のアクセスパターン
CREATE INDEX "idx_att_plan_created"
  ON "attachments"("plan_id", "created_at")
  WHERE "deleted_at" IS NULL;

CREATE TRIGGER trg_attachments_set_updated_at
  BEFORE UPDATE ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION trakon_set_updated_at();
