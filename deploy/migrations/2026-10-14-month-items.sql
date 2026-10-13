-- 月ごとの手当・控除（lib/db/src/schema/month_items.ts と同じ定義）。追加のみ。既存の表は変えない。
BEGIN;

CREATE TABLE IF NOT EXISTS employee_month_sets (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  base_salary double precision,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT employee_month_sets_employee_year_month_unique UNIQUE (employee_id, year, month)
);

CREATE TABLE IF NOT EXISTS employee_month_allowances (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  allowance_definition_id integer NOT NULL,
  allowance_name text NOT NULL,
  is_taxable boolean NOT NULL DEFAULT true,
  exclude_from_employment_insurance boolean NOT NULL DEFAULT false,
  amount double precision NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS employee_month_allowances_lookup ON employee_month_allowances (employee_id, year, month);

CREATE TABLE IF NOT EXISTS employee_month_deductions (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  deduction_definition_id integer NOT NULL,
  deduction_name text NOT NULL,
  amount double precision NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS employee_month_deductions_lookup ON employee_month_deductions (employee_id, year, month);

-- ── 既存の明細ぶんの控えを作る ───────────────────────────────────
-- いまの社員ごとの手当・控除は「最後に作業した月」の内容。過去の月の内訳は残っていない。
-- そこで、明細に保存されている合計（手当の合計・控除の合計）が、いまの手当・控除の合計と
-- 一致する明細だけを「内訳はいまの内容と同じ」とみなして控えにする。
-- 一致しない明細は当時の内訳が分からないので作らない（これまでどおりの表示になる）。
WITH master_a AS (
  -- 同じ手当の行が2つある場合、計算は先頭の1行だけを使っていたので、同じにそろえる
  SELECT DISTINCT ON (ea.employee_id, ea.allowance_definition_id)
         ea.employee_id, ea.allowance_definition_id, d.name, d.is_taxable,
         d.exclude_from_employment_insurance AS excl, ea.amount, ea.sort_order
  FROM employee_allowances ea
  JOIN allowance_definitions d ON d.id = ea.allowance_definition_id AND d.is_active
  ORDER BY ea.employee_id, ea.allowance_definition_id, ea.sort_order, ea.id
),
a_sum AS (SELECT employee_id, COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS total FROM master_a GROUP BY 1),
d_sum AS (SELECT employee_id, COALESCE(SUM(amount), 0) AS total FROM employee_deductions GROUP BY 1),
target AS (
  SELECT p.employee_id, p.year, p.month,
         CASE WHEN e.salary_type = 'daily' THEN p.base_salary END AS base_salary
  FROM payrolls p
  JOIN employees e ON e.id = p.employee_id
  LEFT JOIN a_sum a ON a.employee_id = p.employee_id
  LEFT JOIN d_sum d ON d.employee_id = p.employee_id
  WHERE COALESCE(p.custom_allowances_total, 0) = COALESCE(a.total, 0)
    AND COALESCE(p.custom_deductions_total, 0) = COALESCE(d.total, 0)
    AND NOT EXISTS (SELECT 1 FROM employee_month_sets s WHERE s.employee_id = p.employee_id AND s.year = p.year AND s.month = p.month)
),
ins_set AS (
  INSERT INTO employee_month_sets (employee_id, year, month, base_salary)
  SELECT employee_id, year, month, base_salary FROM target
  RETURNING employee_id, year, month
),
ins_a AS (
  INSERT INTO employee_month_allowances (employee_id, year, month, allowance_definition_id, allowance_name, is_taxable, exclude_from_employment_insurance, amount, sort_order)
  SELECT s.employee_id, s.year, s.month, m.allowance_definition_id, m.name, m.is_taxable, m.excl, m.amount,
         (ROW_NUMBER() OVER (PARTITION BY s.employee_id, s.year, s.month ORDER BY m.sort_order, m.allowance_definition_id) - 1)::int
  FROM ins_set s JOIN master_a m ON m.employee_id = s.employee_id
  RETURNING 1
)
INSERT INTO employee_month_deductions (employee_id, year, month, deduction_definition_id, deduction_name, amount, sort_order)
SELECT s.employee_id, s.year, s.month, ed.deduction_definition_id, COALESCE(dd.name, ''), ed.amount,
       (ROW_NUMBER() OVER (PARTITION BY s.employee_id, s.year, s.month ORDER BY ed.sort_order, ed.id) - 1)::int
FROM ins_set s
JOIN employee_deductions ed ON ed.employee_id = s.employee_id
LEFT JOIN deduction_definitions dd ON dd.id = ed.deduction_definition_id;

COMMIT;
