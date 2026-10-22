-- 第2弾（ドライバー側と勤怠）：追加のみ。既存のデータは変えない。
-- ⚠ 当てる前に、同じ勤務日に出勤・退勤が2つ入っていないか確かめる（あると下の一意インデックスが作れずに止まる）：
--   select employee_id, work_date, event_type, count(*) from attendance_records
--    where event_type in ('clock_in','clock_out') group by 1,2,3 having count(*) > 1;
--   （2026-10-22 の本番の写しでは0件）
-- 打刻：端末の番号（二重送信を捨てる）・取り消しの印（消さずに残す）・どこから入ったか
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS voided_at timestamp;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS voided_by text;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS source text;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_client_unique ON attendance_records (employee_id, client_id) WHERE client_id IS NOT NULL;
-- 同じ勤務日に出勤・退勤が2つ入らないように（取り消したものは数えない）
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_one_clock_in ON attendance_records (employee_id, work_date) WHERE event_type = 'clock_in' AND voided_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_one_clock_out ON attendance_records (employee_id, work_date) WHERE event_type = 'clock_out' AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS attendance_records_emp_date ON attendance_records (employee_id, work_date);
CREATE INDEX IF NOT EXISTS attendance_records_recorded_at ON attendance_records (recorded_at);

-- メッセージ：端末の番号（押し直しで二重に届かないように）
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_id text;
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_unique ON messages (employee_id, client_id) WHERE client_id IS NOT NULL;

-- 打刻の変更の記録
CREATE TABLE IF NOT EXISTS attendance_record_logs (
  id serial PRIMARY KEY,
  record_id integer,
  employee_id integer NOT NULL,
  work_date date,
  action text NOT NULL,
  before text,
  after text,
  actor text NOT NULL,
  reason text,
  at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_record_logs_emp ON attendance_record_logs (employee_id, work_date);

-- 打刻の修正申請
CREATE TABLE IF NOT EXISTS attendance_corrections (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  kind text NOT NULL,
  event_type text,
  record_id integer,
  requested_at timestamp,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  decided_by text,
  decided_at timestamp,
  decision_note text,
  result_record_id integer,
  client_id text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_corrections_client_unique ON attendance_corrections (employee_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_corrections_status ON attendance_corrections (status);

-- 日常点検（1人1日1件）と、出勤後に書き換えたときの履歴
CREATE TABLE IF NOT EXISTS daily_inspections (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  vehicle text,
  items text NOT NULL DEFAULT '{}',
  total integer NOT NULL DEFAULT 0,
  checked integer NOT NULL DEFAULT 0,
  ng text NOT NULL DEFAULT '[]',
  office_action text,
  office_decision text,
  decided_by text,
  decided_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT daily_inspections_emp_date_unique UNIQUE (employee_id, work_date)
);
CREATE TABLE IF NOT EXISTS inspection_history (
  id serial PRIMARY KEY,
  inspection_id integer NOT NULL,
  employee_id integer NOT NULL,
  work_date date NOT NULL,
  before text,
  after text,
  actor text NOT NULL,
  at timestamp NOT NULL DEFAULT now()
);

-- アルコールチェック（1年間保存。社員を消しても残すため社員の表とはつながない）
CREATE TABLE IF NOT EXISTS alcohol_checks (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  employee_name text NOT NULL,
  work_date date NOT NULL,
  phase text NOT NULL,
  checked_at timestamp NOT NULL DEFAULT now(),
  value_mg double precision,
  detected boolean NOT NULL DEFAULT false,
  method text NOT NULL,
  checker text,
  vehicle text,
  note text,
  client_id text,
  updated_by text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS alcohol_checks_client_unique ON alcohol_checks (employee_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS alcohol_checks_date ON alcohol_checks (work_date);

-- 日報（1人1日1件）
CREATE TABLE IF NOT EXISTS daily_reports (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  vehicle text,
  departure text,
  arrival text,
  start_odometer double precision,
  end_odometer double precision,
  distance_km double precision,
  shipper text,
  waiting_minutes integer,
  note text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT daily_reports_emp_date_unique UNIQUE (employee_id, work_date)
);

-- 勤怠の設定（1行だけ）
CREATE TABLE IF NOT EXISTS attendance_settings (
  id integer PRIMARY KEY DEFAULT 1,
  data text NOT NULL DEFAULT '{}',
  updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO attendance_settings (id, data) VALUES (1, '{}') ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('2026-10-24-batch-b.sql') ON CONFLICT DO NOTHING;
