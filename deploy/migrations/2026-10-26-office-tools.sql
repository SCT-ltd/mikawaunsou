-- 事務所の作業を減らすため（追加のみ。既存のデータは変えない）
-- 社員の電話番号（勤怠管理から電話をかけるため）
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone text;
-- 月の勤怠表の「確認済み」
CREATE TABLE IF NOT EXISTS attendance_month_checks (
  employee_id integer NOT NULL,
  ym text NOT NULL,
  checked_by text,
  checked_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT attendance_month_checks_unique UNIQUE (employee_id, ym)
);
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now());
INSERT INTO schema_migrations (name) VALUES ('2026-10-26-office-tools.sql') ON CONFLICT DO NOTHING;
