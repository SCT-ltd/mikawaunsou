-- 第1弾（安全面）：操作の記録・QR の合言葉（追加のみ。既存のデータは変えない。合言葉と暗証番号の保存形式は api の起動時に入れる）
CREATE TABLE IF NOT EXISTS audit_logs (
  id serial PRIMARY KEY,
  at timestamp NOT NULL DEFAULT now(),
  user_id integer,
  actor text NOT NULL,
  action text NOT NULL,
  target text,
  detail text,
  ip text
);
CREATE INDEX IF NOT EXISTS audit_logs_at ON audit_logs (at);
CREATE INDEX IF NOT EXISTS audit_logs_target ON audit_logs (target);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS qr_key text;
-- どこまで当てたかの記録
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now());
INSERT INTO schema_migrations (name) VALUES ('2026-10-14-month-items.sql'), ('2026-10-15-auto-values.sql'), ('2026-10-22-public-holiday.sql'), ('2026-10-22-alerts.sql'), ('2026-10-22-employment-insurance-override.sql'), ('2026-10-23-security.sql') ON CONFLICT DO NOTHING;
