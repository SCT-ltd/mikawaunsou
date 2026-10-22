# lib/db — Drizzle スキーマと DB シングルトン（`@workspace/db`）

PostgreSQL への接続（pg `Pool`）と Drizzle ORM のスキーマ定義を提供する共有パッケージ。**import 時に `DATABASE_URL` が必須**。スキーマ変更は `deploy/migrations/` の SQL を手で当てる（2026-10 から。`drizzle-kit push` は止めてある）。

## 主要ファイル

- `src/index.ts` — pg `Pool` / `db`（Drizzle インスタンス）シングルトン。`DATABASE_URL` を参照
- `src/schema/` — テーブル定義
  - `company` — 会社マスタ（締め日・支払日・保険料率・割増率 等）
  - `employees` — 社員マスタ（基本給・各手当・扶養・個人単価 等）
  - `monthly_records` — 月次実績（出勤日数・残業/深夜時間・走行距離・件数 等）
  - `payrolls` — 給与計算結果
  - `journal_entries` — 振替伝票
  - `allowances` — カスタム手当（定義・社員別金額）
  - `attendance` — 打刻記録
  - `calendar` — カレンダー
  - `insurance` — `insurance_rate_periods`（社会保険・雇用保険の料率の履歴）/ `standard_remuneration_history`（社員ごとの標準報酬月額の履歴）
  - `messages` — メッセージ / プッシュ購読
  - `sessions` — セッション（connect-pg-simple 用、`createTableIfMissing:false`）
  - `users` — `system_users`（アカウント）
  - `index.ts` — スキーマ集約 export
- `drizzle.config.ts` — drizzle-kit 設定

## スタック・依存

- drizzle-orm / drizzle-zod / pg / zod（devDeps: drizzle-kit, @types/pg, @types/node）

## コマンド

- スキーマ反映（dev のみ）: `pnpm --filter @workspace/db run push`
- 強制反映: （2026-10 から使わない）`deploy/migrations/` の SQL を手で当てる

## 現在のステータス

- 実装済み: 上記スキーマ一式
- 注意: フィールドの詳細・新規カラムの意味は `replit.md` の「Database Schema」を正典とする（ここでは重複させない）

- 2026-10-24: batch-d の列・表を追加（`schema/payroll_law.ts`：住民税の12か月分・有給の調整・賞与・年末調整の申告書・雇用保険の不足の精算。company にスイッチと最低賃金など、employees に保険・税の印・名簿・退職、monthly_records に rest_day_overtime_hours、allowance_definitions に include_in_premium_base、payrolls に health_insurance_amount / pension_amount / calc_warnings）。SQL は `deploy/migrations/2026-10-24-batch-d.sql`。

## 決定事項

- 2026-09-14 **保険料率と標準報酬月額の履歴テーブルを追加**（年度改定・定時決定をマスターで切り替えるため）。
  - `insurance_rate_periods`: 適用開始（`effective_year` / `effective_month` ＝給与明細の年月、一意）、`health_insurance_rate` / `care_insurance_rate` / `childcare_support_rate` / `pension_rate`（いずれも会社＋本人の合計の率）、`employment_insurance_rate`（本人負担）、`pension_max_standard`（既定650,000）、`note`。
  - `standard_remuneration_history`: `employee_id`（社員削除でカスケード）、適用開始（社員×年月で一意）、`amount`、`reason`（teiji/zuiji/shikaku/other）、`note`。
  - `payrolls` に計算に使った基準のスナップショット列を追加（すべて null 可。この変更より前の明細は null）: `applied_standard_remuneration`、`applied_health_insurance_rate`、`applied_care_insurance_rate`（介護対象外は0）、`applied_childcare_support_rate`、`applied_pension_rate`、`applied_employment_insurance_rate`。
  - `company.employment_insurance_rate` / `health_insurance_employee_rate` などの会社設定の料率列は、計算では使わなくなった（料率の表が空のときの初期値として雇用保険料率だけ読む）。列は残置。
  - 本番反映: 2026-09-14 に `deploy/release-2026-09-14-insurance.ps1` と同じ DDL（CREATE TABLE IF NOT EXISTS ×2、ADD COLUMN IF NOT EXISTS ×6）を NAS の db コンテナに適用済み（既存の明細106件は不変）。料率の初期行は、API への初回アクセス時に自動で作られる。

- 2026-08-26 有給の日数管理のため2列追加: `monthly_records.paid_leave_days`（0.5=半休。欠勤控除の対象にしない）、`payrolls.paid_leave_days`（明細表示用スナップショット）。いずれも `notNull().default(0)`。**本番反映には NAS 側で列追加が必要**。
- 2026-08-26 日曜出勤の時間計算化に伴い2列追加: `monthly_records.sunday_work_hours`（日曜・祝日の出勤時間。会社設定 `company.hourly_wage_sunday`（既定1,655）と掛けて手当を算出）、`payrolls.holiday_work_hours`（明細の勤怠欄表示用スナップショット）。いずれも `notNull().default(0)`。既存の `sunday_work_days` / `holiday_work_days` は過去データの表示互換のため残置（金額計算には使わない）。**本番反映には NAS 側で `drizzle-kit push` が必要**。
- 2026-07-02 このファイル作成（db 階層の overview 初版）
- 2026-07-10 `payrolls` に `saturday_work_days`(double, default 0) を追加。給与明細印刷で土曜出勤日数が常に0だった不具合対応（列が無く保存先が無かった）。合わせて payroll 保存時に休日日数表示は月次実績の `sunday_work_days`(「日曜/祝日」列)から採るよう是正（従来は入力に使われない `holiday_work_days` を参照し常に0だった）。本番へは `ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS saturday_work_days ...` ＋ 月次実績からの日数バックフィルで反映（金額列は不変）。
- 2026-07-13 上記を本番 Neon へ実際に反映。`drizzle-kit push` で `saturday_work_days` 列を追加し、既存 payroll 20件（うち確定済み8件）に月次実績から日数をバックフィル（`saturday_work_days` は新規列のため全件転記、`holiday_work_days` は `sunday_work_days <> 0` の行のみ転記して既存の非0レガシー値を0で潰さないようにした）。**金額列は一切変更していない**ため確定済み明細の支給額・控除額・差引支給額は不変で、確定解除も不要だった。
  - ※ Windows では `drizzle-kit push` が `drizzle.config.ts` のバックスラッシュ schema パスを解決できず「No schema files found」になる。`schema: "./src/schema/index.ts"` に一時変更して push し、実行後に revert する（CLAUDE.md の Windows 節参照）。
