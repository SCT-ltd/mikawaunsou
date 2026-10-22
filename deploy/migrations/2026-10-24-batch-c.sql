-- 第3弾（事務所の管理画面）：振込口座と振込元の設定（追加のみ。既存のデータは変えない）
-- 社員の口座は社員の表に足さず、別の表に分ける（社員の一覧・QR打刻ページの応答に口座が載らないように）
CREATE TABLE IF NOT EXISTS employee_bank_accounts (
  employee_id integer PRIMARY KEY,
  bank_code text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  branch_code text NOT NULL DEFAULT '',
  branch_name text NOT NULL DEFAULT '',
  account_type integer NOT NULL DEFAULT 1,
  account_number text NOT NULL DEFAULT '',
  holder_kana text NOT NULL DEFAULT '',
  updated_at timestamp NOT NULL DEFAULT now()
);
-- 振込元（会社の口座）と委託者。1行だけ使う（id=1）
CREATE TABLE IF NOT EXISTS transfer_settings (
  id integer PRIMARY KEY,
  consignor_code text NOT NULL DEFAULT '',
  consignor_name text NOT NULL DEFAULT '',
  bank_code text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  branch_code text NOT NULL DEFAULT '',
  branch_name text NOT NULL DEFAULT '',
  account_type integer NOT NULL DEFAULT 1,
  account_number text NOT NULL DEFAULT '',
  kind_code text NOT NULL DEFAULT '11',
  designation text NOT NULL DEFAULT '',
  newline boolean NOT NULL DEFAULT true,
  updated_at timestamp NOT NULL DEFAULT now()
);
-- どこまで当てたかの記録
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now());
INSERT INTO schema_migrations (name) VALUES ('2026-10-24-batch-c.sql') ON CONFLICT DO NOTHING;
