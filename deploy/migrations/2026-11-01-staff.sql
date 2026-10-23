-- スタッフの打刻ページの追加（経費・立替の申請・休みの申請・写真・アルコール検知器の写真）。追加のみ
CREATE TABLE IF NOT EXISTS staff_files (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  kind text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_files_emp ON staff_files (employee_id);

CREATE TABLE IF NOT EXISTS expense_claims (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  use_date date NOT NULL,
  category text NOT NULL,
  amount integer NOT NULL,
  note text,
  file_id integer,
  status text NOT NULL DEFAULT 'pending',
  settle_year integer,
  settle_month integer,
  decided_by text,
  decided_at timestamp,
  decision_note text,
  client_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT expense_claims_client UNIQUE (employee_id, client_id)
);
CREATE INDEX IF NOT EXISTS expense_claims_emp ON expense_claims (employee_id);

CREATE TABLE IF NOT EXISTS leave_requests (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  work_date date NOT NULL,
  absence_type text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  decided_by text,
  decided_at timestamp,
  decision_note text,
  absence_id integer,
  client_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_client UNIQUE (employee_id, client_id)
);
CREATE INDEX IF NOT EXISTS leave_requests_emp ON leave_requests (employee_id);

ALTER TABLE alcohol_checks ADD COLUMN IF NOT EXISTS photo_file_id integer;

CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now());
INSERT INTO schema_migrations (name) VALUES ('2026-11-01-staff.sql') ON CONFLICT DO NOTHING;
