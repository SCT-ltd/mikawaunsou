-- 明細に祝日の出勤日数を残す（追加のみ。既存の明細は 0）。
ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS public_holiday_work_days double precision NOT NULL DEFAULT 0;
