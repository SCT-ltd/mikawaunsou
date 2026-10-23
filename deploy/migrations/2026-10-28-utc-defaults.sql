-- 時刻を UTC にそろえる（データは消さない）
-- これまで DB の既定値 now() で入った時刻は、本番の DB が日本時間のため日本時間で入っていた。
-- アプリは UTC として読むので、画面では9時間ずれていた（チャットの時刻など）。
-- アプリの接続を UTC にした（lib/db）ので、これまでの分だけ1回そろえる。対象は既定値でしか入らない列だけ。
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '2026-10-28-utc-defaults.sql') AND current_setting('TimeZone') NOT IN ('UTC', 'Etc/UTC') THEN
    UPDATE messages SET created_at = (created_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC';
    UPDATE attendance_corrections SET created_at = (created_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC';
  END IF;
END $$;
INSERT INTO schema_migrations (name) VALUES ('2026-10-28-utc-defaults.sql') ON CONFLICT DO NOTHING;
