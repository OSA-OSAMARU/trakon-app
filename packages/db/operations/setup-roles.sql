-- =============================================================================
-- TRAKON — DB ロール分離スクリプト
-- -----------------------------------------------------------------------------
-- 設計書 §6.9 / §5.4 多層防御 Layer 1
-- 本番および dev で「app_user は DML のみ、app_migrator のみ DDL 可」を強制する。
--
-- 実行手順（一度だけ）:
--   psql "$DATABASE_URL" -f packages/db/operations/setup-roles.sql
--
-- このスクリプトは Prisma migrations には含めない（Prisma は app_migrator として
-- 接続することを想定）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ロール作成 (パスワードは Vercel Env / Supabase Vault から渡す)
--    既に存在する場合はスキップ
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    EXECUTE format('CREATE ROLE app_migrator LOGIN PASSWORD %L', current_setting('trakon.migrator_password'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE format('CREATE ROLE app_user LOGIN PASSWORD %L', current_setting('trakon.app_user_password'));
  END IF;
END $$;

-- パスワード設定例 (psql 実行時):
--   psql -v trakon.migrator_password='xxxx' -v trakon.app_user_password='yyyy' -f setup-roles.sql

-- -----------------------------------------------------------------------------
-- 2. スキーマ・既存オブジェクトの所有権を app_migrator に
-- -----------------------------------------------------------------------------
ALTER SCHEMA public OWNER TO app_migrator;

-- 既存テーブル所有権の譲渡
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO app_migrator;', r.tablename);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. app_user に DML のみ付与
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- 今後 app_migrator が作る新規オブジェクトにも自動付与
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- -----------------------------------------------------------------------------
-- 4. append-only テーブルから UPDATE/DELETE を REVOKE (多層防御 Layer 1)
--    トリガと併用して二重に拒否する。
-- -----------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM app_user;
REVOKE UPDATE, DELETE ON TABLE public.ball_events FROM app_user;

-- 今後 audit_logs / ball_events に GRANT を追加するときは UPDATE/DELETE を含めない

-- -----------------------------------------------------------------------------
-- 5. 監査ログのトリガ関数の SECURITY DEFINER 化 (任意・Phase 1 検討)
--    アプリの app_user が直接 audit_logs 以外を経由できないようにする場合に検討
-- -----------------------------------------------------------------------------

-- 完了メッセージ
\echo 'app_user / app_migrator を作成し DML/DDL を分離しました。'
\echo 'アプリの DATABASE_URL は app_user で接続し、'
\echo 'GitHub Actions の release-deploy.yml は app_migrator で接続してください。'
