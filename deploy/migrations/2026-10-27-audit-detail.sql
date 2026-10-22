-- 操作の記録を細かくする（列の追加のみ。記録は消さない）
-- summary: 日本語の一文（例「打刻を修正（社員名）」）／category: 勤怠・給与・社員…／status: 応答の番号（断られた操作も残す）
-- employee_id: 対象の社員（社員ごとに絞り込むため）／user_agent: 端末（パソコン・スマホの見分け）
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status integer;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS employee_id integer;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent text;
CREATE INDEX IF NOT EXISTS audit_logs_category ON audit_logs (category);
CREATE INDEX IF NOT EXISTS audit_logs_employee ON audit_logs (employee_id);
-- これまでの記録の時刻は DB の既定値 now()（本番の DB は日本時間）で入っていて、画面では9時間ずれて見えていた。
-- これからはアプリが時刻を入れる（UTC）。これまでの分を、1回だけ同じ形にそろえる
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '2026-10-27-audit-detail.sql') AND current_setting('TimeZone') NOT IN ('UTC', 'Etc/UTC') THEN
    UPDATE audit_logs SET at = (at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC';
  END IF;
END $$;
INSERT INTO schema_migrations (name) VALUES ('2026-10-27-audit-detail.sql') ON CONFLICT DO NOTHING;
