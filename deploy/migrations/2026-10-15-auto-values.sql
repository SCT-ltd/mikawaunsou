-- 月の控えに「最後に勤怠から出した金額」を持たせる（追加のみ。既存の行は NULL＝金額には触らない）。
ALTER TABLE employee_month_sets ADD COLUMN IF NOT EXISTS auto_values text;
