-- チャットの添付（写真・PDF）。追加のみ
CREATE TABLE IF NOT EXISTS message_attachments (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  message_id integer,
  uploaded_by text NOT NULL,
  file_name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_attachments_message ON message_attachments (message_id);
CREATE INDEX IF NOT EXISTS message_attachments_emp ON message_attachments (employee_id);
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now());
INSERT INTO schema_migrations (name) VALUES ('2026-10-31-attachments.sql') ON CONFLICT DO NOTHING;
