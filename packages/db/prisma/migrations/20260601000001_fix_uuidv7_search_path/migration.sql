-- =============================================================================
-- Migration: 20260601000001_fix_uuidv7_search_path
-- uuidv7() の search_path を修正して Supabase ローカル環境で動作させる
-- =============================================================================
-- 問題:
--   Supabase は pgcrypto を extensions スキーマにインストールする。
--   init_auth で定義した uuidv7() は SET search_path を指定していないため、
--   関数実行時に gen_random_bytes が解決できず
--   「function gen_random_bytes(integer) does not exist」エラーになる。
--
-- 修正:
--   uuidv7() に SET search_path = public, extensions を付与して再定義する。
--   これにより public / extensions どちらに pgcrypto があっても動作する。
-- =============================================================================

CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  buffer bytea;
BEGIN
  unix_ts_ms := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  buffer := unix_ts_ms || gen_random_bytes(10);
  buffer := set_byte(buffer, 6, (b'01110000'::bit(8) | get_byte(buffer, 6)::bit(8) & b'00001111'::bit(8))::int);
  buffer := set_byte(buffer, 8, (b'10000000'::bit(8) | get_byte(buffer, 8)::bit(8) & b'00111111'::bit(8))::int);
  RETURN encode(buffer, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE SET search_path = public, extensions;
