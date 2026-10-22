-- 2026-10-24 給与計算と法令（batch-d）。追加だけ（既存の列・行は消さない・値も変えない）。
-- 何度流しても同じ結果になる（IF NOT EXISTS）。
BEGIN;

-- 会社設定：計算の切り替え（既定はすべて OFF＝今までどおり）・最低賃金・仕訳の計上日など
ALTER TABLE company ADD COLUMN IF NOT EXISTS rule_premium_base_includes_allowances boolean NOT NULL DEFAULT false;
ALTER TABLE company ADD COLUMN IF NOT EXISTS rule_rest_day_overtime boolean NOT NULL DEFAULT false;
ALTER TABLE company ADD COLUMN IF NOT EXISTS rule_over60_includes_rest_days boolean NOT NULL DEFAULT false;
ALTER TABLE company ADD COLUMN IF NOT EXISTS rule_bluewing_performance_v2 boolean NOT NULL DEFAULT false;
ALTER TABLE company ADD COLUMN IF NOT EXISTS rule_bluewing_over60 boolean NOT NULL DEFAULT false;
ALTER TABLE company ADD COLUMN IF NOT EXISTS rule_commission_premium boolean NOT NULL DEFAULT false;
ALTER TABLE company ADD COLUMN IF NOT EXISTS rule_paid_leave_by_salary_type boolean NOT NULL DEFAULT false;
ALTER TABLE company ADD COLUMN IF NOT EXISTS rule_hourly_holiday_no_double boolean NOT NULL DEFAULT false;
ALTER TABLE company ADD COLUMN IF NOT EXISTS rule_absence_deduction boolean NOT NULL DEFAULT false;
ALTER TABLE company ADD COLUMN IF NOT EXISTS absence_deduction_method text NOT NULL DEFAULT 'fixed22';
ALTER TABLE company ADD COLUMN IF NOT EXISTS health_childcare_rounding text NOT NULL DEFAULT 'separate';
ALTER TABLE company ADD COLUMN IF NOT EXISTS scheduled_hours_per_day double precision NOT NULL DEFAULT 8;
ALTER TABLE company ADD COLUMN IF NOT EXISTS minimum_wage_hourly double precision NOT NULL DEFAULT 1226;
ALTER TABLE company ADD COLUMN IF NOT EXISTS minimum_wage_effective_date date DEFAULT '2025-10-03';
ALTER TABLE company ADD COLUMN IF NOT EXISTS journal_date_basis text NOT NULL DEFAULT 'closing';
ALTER TABLE company ADD COLUMN IF NOT EXISTS child_contribution_rate double precision NOT NULL DEFAULT 0.0036;
ALTER TABLE company ADD COLUMN IF NOT EXISTS overtime_year_start_month integer NOT NULL DEFAULT 4;
ALTER TABLE company ADD COLUMN IF NOT EXISTS bonus_tax_rate_table text;

-- 社員：保険・税の印を分ける／75歳の健康保険／源泉税の区分／通勤／労働者名簿／退職
ALTER TABLE employees ADD COLUMN IF NOT EXISTS social_insurance_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_insurance_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS income_tax_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS health_insurance_mode text NOT NULL DEFAULT 'auto';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tax_column text NOT NULL DEFAULT 'kou';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS disability text NOT NULL DEFAULT 'none';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS widow boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS single_parent boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS working_student boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS dependent_disability_count integer NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS commute_method text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS commute_distance_km double precision;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS weekly_scheduled_days double precision;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS weekly_scheduled_hours double precision;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_type text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS retirement_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS retirement_reason text;

-- 旧「全額非課税」の人は、分けた3つの印をすべて ON にする（計算の結果は今までと同じ）。
-- 印の列を作ったこの1回だけ写す（2回目以降に流しても、画面で外した印を戻さない）。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '2026-10-24-batch-d.sql') THEN
    UPDATE employees SET social_insurance_exempt = true, employment_insurance_exempt = true, income_tax_exempt = true
      WHERE tax_exempt = true;
  END IF;
END $$;

-- 月次実績：土曜・祝日の8時間超の時間
ALTER TABLE monthly_records ADD COLUMN IF NOT EXISTS rest_day_overtime_hours double precision NOT NULL DEFAULT 0;

-- 手当マスター：割増の基礎に入れる
ALTER TABLE allowance_definitions ADD COLUMN IF NOT EXISTS include_in_premium_base boolean NOT NULL DEFAULT false;

-- 明細：健康保険料・厚生年金保険料を分けて残す／計算の注意
ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS health_insurance_amount double precision;
ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS pension_amount double precision;
ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS calc_warnings text;

CREATE TABLE IF NOT EXISTS resident_tax_schedules (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  collect_year integer NOT NULL,
  collect_month integer NOT NULL,
  amount double precision NOT NULL DEFAULT 0,
  note text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT resident_tax_schedules_emp_month_unique UNIQUE (employee_id, collect_year, collect_month)
);

CREATE TABLE IF NOT EXISTS paid_leave_adjustments (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  date date NOT NULL,
  days double precision NOT NULL,
  note text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paid_leave_adjustments_emp ON paid_leave_adjustments (employee_id);

CREATE TABLE IF NOT EXISTS bonus_payments (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  pay_date date NOT NULL,
  amount double precision NOT NULL,
  period_months integer NOT NULL DEFAULT 6,
  standard_bonus double precision NOT NULL DEFAULT 0,
  health_standard double precision NOT NULL DEFAULT 0,
  pension_standard double precision NOT NULL DEFAULT 0,
  health_insurance double precision NOT NULL DEFAULT 0,
  childcare_support_contribution double precision NOT NULL DEFAULT 0,
  pension double precision NOT NULL DEFAULT 0,
  employment_insurance double precision NOT NULL DEFAULT 0,
  income_tax double precision,
  net_amount double precision,
  income_tax_method text,
  status text NOT NULL DEFAULT 'draft',
  note text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bonus_payments_emp ON bonus_payments (employee_id);

CREATE TABLE IF NOT EXISTS yearend_declarations (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  year integer NOT NULL,
  data text NOT NULL DEFAULT '{}',
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT yearend_declarations_emp_year_unique UNIQUE (employee_id, year)
);

CREATE TABLE IF NOT EXISTS employment_insurance_settlements (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  from_year integer NOT NULL,
  from_month integer NOT NULL,
  amount double precision NOT NULL,
  apply_year integer NOT NULL,
  apply_month integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT employment_insurance_settlements_unique UNIQUE (employee_id, from_year, from_month)
);

INSERT INTO schema_migrations (name) VALUES ('2026-10-24-batch-d.sql') ON CONFLICT DO NOTHING;
COMMIT;
