# lib/db — Drizzle スキーマと DB シングルトン（`@workspace/db`）

PostgreSQL への接続（pg `Pool`）と Drizzle ORM のスキーマ定義を提供する共有パッケージ。**import 時に `DATABASE_URL` が必須**。スキーマ変更はマイグレーションファイルではなく `drizzle-kit push` で適用する（このスキーマが真実の源）。

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
  - `messages` — メッセージ / プッシュ購読
  - `sessions` — セッション（connect-pg-simple 用、`createTableIfMissing:false`）
  - `users` — `system_users`（アカウント）
  - `index.ts` — スキーマ集約 export
- `drizzle.config.ts` — drizzle-kit 設定

## スタック・依存

- drizzle-orm / drizzle-zod / pg / zod（devDeps: drizzle-kit, @types/pg, @types/node）

## コマンド

- スキーマ反映（dev のみ）: `pnpm --filter @workspace/db run push`
- 強制反映: `pnpm --filter @workspace/db run push-force`

## 現在のステータス

- 実装済み: 上記スキーマ一式
- 注意: フィールドの詳細・新規カラムの意味は `replit.md` の「Database Schema」を正典とする（ここでは重複させない）

## 決定事項

- 2026-07-02 このファイル作成（db 階層の overview 初版）
- 2026-07-10 `payrolls` に `saturday_work_days`(double, default 0) を追加。給与明細印刷で土曜出勤日数が常に0だった不具合対応（列が無く保存先が無かった）。合わせて payroll 保存時に休日日数表示は月次実績の `sunday_work_days`(「日曜/祝日」列)から採るよう是正（従来は入力に使われない `holiday_work_days` を参照し常に0だった）。本番へは `ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS saturday_work_days ...` ＋ 月次実績からの日数バックフィルで反映（金額列は不変）。
- 2026-07-13 上記を本番 Neon へ実際に反映。`drizzle-kit push` で `saturday_work_days` 列を追加し、既存 payroll 20件（うち確定済み8件）に月次実績から日数をバックフィル（`saturday_work_days` は新規列のため全件転記、`holiday_work_days` は `sunday_work_days <> 0` の行のみ転記して既存の非0レガシー値を0で潰さないようにした）。**金額列は一切変更していない**ため確定済み明細の支給額・控除額・差引支給額は不変で、確定解除も不要だった。
  - ※ Windows では `drizzle-kit push` が `drizzle.config.ts` のバックスラッシュ schema パスを解決できず「No schema files found」になる。`schema: "./src/schema/index.ts"` に一時変更して push し、実行後に revert する（CLAUDE.md の Windows 節参照）。
