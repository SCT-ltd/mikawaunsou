-- リアルタイムマップ（追加のみ。既存のデータは変えない）
-- 位置の記録（道すじ・走行距離の目安・長く止まっている場所）
CREATE TABLE IF NOT EXISTS location_points (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  work_date date NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy double precision,
  recorded_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS location_points_emp_date ON location_points (employee_id, work_date);
CREATE INDEX IF NOT EXISTS location_points_at ON location_points (recorded_at);
-- よく行く場所
CREATE TABLE IF NOT EXISTS places (
  id serial PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'site',
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  radius_m integer NOT NULL DEFAULT 150,
  address text,
  note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
-- 場所への到着・出発
CREATE TABLE IF NOT EXISTS place_visits (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  place_id integer NOT NULL,
  place_name text NOT NULL,
  work_date date NOT NULL,
  arrived_at timestamp NOT NULL,
  left_at timestamp
);
CREATE INDEX IF NOT EXISTS place_visits_emp_date ON place_visits (employee_id, work_date);
CREATE INDEX IF NOT EXISTS place_visits_date ON place_visits (work_date);
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now());
INSERT INTO schema_migrations (name) VALUES ('2026-10-29-map.sql') ON CONFLICT DO NOTHING;
