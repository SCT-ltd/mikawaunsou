-- 出勤の予定（シフト）と予定の型（追加のみ。既存のデータは変えない）
CREATE TABLE IF NOT EXISTS work_schedules (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  work_date date NOT NULL,
  start_time text,
  end_time text,
  is_off boolean NOT NULL DEFAULT false,
  note text,
  updated_by text,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT work_schedules_emp_date_unique UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS work_schedules_date ON work_schedules (work_date);
CREATE TABLE IF NOT EXISTS schedule_patterns (
  employee_id integer PRIMARY KEY,
  data text NOT NULL DEFAULT '{}',
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now());
INSERT INTO schema_migrations (name) VALUES ('2026-10-25-schedules.sql') ON CONFLICT DO NOTHING;
