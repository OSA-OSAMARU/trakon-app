-- =============================================================================
-- Migration: 20260901000003_add_project_role_type
-- Phase 0.5 (権限ロール): project_members.role_type を実体化し、
-- 招待にロール・組織・招待者を持たせる。
-- 設計書: docs/design/02-database.md §2.4.3 / §2.4.8、07-billing.md §7.12
--
-- 【実データ影響（精査済み・破壊的操作あり）】
--   - role_type は列としては Phase 0 から存在するが、アプリからは一度も
--     書き込まれておらず全行 NULL。backfill してから NOT NULL 化する。
--   - backfill 規則:
--       admin  … プロジェクト作成者 (created_by) 本人の行、
--                **および進行責任者 (progress_manager_member_id) の行**
--       editor … それ以外
--     進行責任者も admin にするのは、作成者だけを admin にすると
--     「作成者以外が進行責任者」のプロジェクトで TOSS を実行できる人が
--     誰もいなくなるため (TOSS は管理者限定)。
--   - member_type='client' を viewer へ自動降格させることは **しない**。
--     既存データでクライアントが承認者になっている場合に承認不能になるため。
--     降格は UI から明示的に行う。
--   - invitations.organization_id は既存行をプロジェクトの組織で backfill する。
--     20260901000001 / 20260901000002 の先行適用が必須。
--   - SET NOT NULL は ACCESS EXCLUSIVE ロック + 全表スキャンを伴う。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) project_members.role_type
-- -----------------------------------------------------------------------------

-- updated_at を保持したまま backfill する (トリガを一時停止。#131 と同じ手法)
ALTER TABLE "project_members" DISABLE TRIGGER "trg_project_members_set_updated_at";

UPDATE "project_members" pm
SET "role_type" = 'admin'
FROM "projects" p
WHERE pm."project_id" = p."id"
  AND (pm."user_id" = p."created_by" OR pm."id" = p."progress_manager_member_id");

UPDATE "project_members" SET "role_type" = 'editor' WHERE "role_type" IS NULL;

ALTER TABLE "project_members" ENABLE TRIGGER "trg_project_members_set_updated_at";

ALTER TABLE "project_members"
  ADD CONSTRAINT "ck_pm_role_type" CHECK ("role_type" IN ('admin', 'editor', 'viewer'));

ALTER TABLE "project_members" ALTER COLUMN "role_type" SET DEFAULT 'editor';
ALTER TABLE "project_members" ALTER COLUMN "role_type" SET NOT NULL;

COMMENT ON COLUMN "project_members"."role_type" IS
  '権限ロール admin/editor/viewer。操作権限の唯一の根拠 (member_type/job_title は表示専用)';

-- -----------------------------------------------------------------------------
-- 2) invitations: 受諾時に付与するロール・座席カウント用の組織・招待者
-- -----------------------------------------------------------------------------
ALTER TABLE "invitations" ADD COLUMN "organization_id" UUID;
ALTER TABLE "invitations" ADD COLUMN "invited_by_user_id" UUID;

UPDATE "invitations" i
SET "organization_id" = p."organization_id"
FROM "projects" p
WHERE i."project_id" = p."id" AND i."organization_id" IS NULL;

UPDATE "invitations" SET "role_type" = 'editor' WHERE "role_type" IS NULL;

ALTER TABLE "invitations"
  ADD CONSTRAINT "ck_inv_role_type" CHECK ("role_type" IN ('admin', 'editor', 'viewer'));

ALTER TABLE "invitations" ALTER COLUMN "role_type" SET DEFAULT 'editor';
ALTER TABLE "invitations" ALTER COLUMN "role_type" SET NOT NULL;
ALTER TABLE "invitations" ALTER COLUMN "organization_id" SET NOT NULL;

ALTER TABLE "invitations"
  ADD CONSTRAINT "fk_inv_organization_id" FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitations"
  ADD CONSTRAINT "fk_inv_invited_by_user_id" FOREIGN KEY ("invited_by_user_id")
  REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON COLUMN "invitations"."organization_id" IS
  '座席カウントの単位。未受諾かつ有効期限内の招待は 1 座席を消費する';

-- 座席カウント用。未受諾かつ未失効の招待だけを引く
CREATE INDEX "idx_inv_org_pending" ON "invitations"("organization_id")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- -----------------------------------------------------------------------------
-- 3) audit_logs.action にロール・組織系を追加
--    (課金系は 20260901000005 でまとめて追加する)
-- -----------------------------------------------------------------------------
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
    -- Phase 0.5: 組織・ロール系
    'org_member_added',
    'org_member_removed',
    'org_role_changed',
    'invitation_created',
    'invitation_revoked',
    'project_role_changed',
    'retained_projects_changed'
  ));
