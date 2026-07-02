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
