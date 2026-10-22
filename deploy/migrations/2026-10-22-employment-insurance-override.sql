-- その月の雇用保険料を手で決めた額（追加のみ。既存は NULL＝自動計算）。
ALTER TABLE employee_month_sets ADD COLUMN IF NOT EXISTS employment_insurance_override double precision;
