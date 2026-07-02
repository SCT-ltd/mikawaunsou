# artifacts/api-server — 三川運送システムの Express 5 API サーバ（`@workspace/api-server`）

給与計算・勤怠・メッセージ等のバックエンド API。`/api` にマウントし、ポート **8080** で待受。esbuild で単一 ESM にバンドルして起動する（`tsc` ではない）。

> 詳細なドメイン仕様（DBスキーマ・税額/社保計算・認証モデル・公開ルート）は プロジェクトルートの `replit.md` が正典。ここでは api-server 内部の地図だけを書く。

## 主要ファイル

- `src/index.ts` — エントリポイント
- `src/app.ts` — Express アプリ構築
- `src/routes/index.ts` — 全ルートを `/api` にマウント。prefix ベースの `requireAdmin` 認可、公開フロー判定 `isPublicDriverFlowRequest()`
- `src/routes/*.ts` — 機能別ルート（`auth`, `employees`, `payroll`, `monthly_records`, `attendance`, `allowances`, `absences`, `calendar`, `company`, `dashboard`, `journal_entries`, `messages`, `users`, `health`）
- `src/lib/payroll-calculator.ts` — 給与計算エンジン（基本給/残業/深夜/歩合/源泉税/社保）
- `src/lib/tax-tables-reiwa8.ts` — 令和8年テーブル（共有 lib のラッパ）。値変更は要出典
- `src/lib/auth-middleware.ts` — `requireOwnerOrAdmin` 系（未ログイン通過・ログイン中は本人のみ）
- `src/lib/params.ts` — Express 5 の route params を string に強制（TS2345 対策、コミット c8e6ea9）
- `src/lib/logger.ts` — pino ロガー
- `src/middlewares/` — ミドルウェア
- `build.mjs` — esbuild バンドル設定

## スタック・依存

- Express 5 / express-session + connect-pg-simple（セッションを Postgres 保存）/ pino / web-push / cors / cookie-parser
- ワークスペース依存: `@workspace/db`, `@workspace/api-zod`, `@workspace/tax-tables-reiwa8`
- フロントとは直接 import せず、OpenAPI 契約（`lib/api-spec`）経由でのみ接続

## コマンド

- 型チェック: `pnpm --filter @workspace/api-server run typecheck`
- ビルド: `pnpm --filter @workspace/api-server run build`（`build.mjs`）
- 起動: `pnpm --filter @workspace/api-server run start`（要 env: `PORT` `DATABASE_URL` `SESSION_SECRET` `VAPID_*`）
- ※ Windows では `dev`(sh の export 依存)を避け、`build` → `start` を個別に実行

## 現在のステータス

- 実装済み: 上記ルート群・給与エンジン・認証・公開QRフロー・メッセージ/Push・勤怠打刻
- 未実装/弱点: 公開エンドポイントの本人性担保（body/URL の employeeId をそのまま採用。replit.md 参照）

## 決定事項

- 2026-07-02 このファイル作成（api-server 階層の overview 初版）
- 2026-07-02 三川ロジックを削除（デッドコード整理・フェーズ1）。フロントの給与計算呼び出しは `useMikawaLogic` を送っておらず未使用だったため、`payroll-calculator.ts` の `calculateMikawaPayroll`/`MikawaPayrollInput`/`MikawaPayrollResult`/`MIKAWA_DAILY_BASE` と、`payroll.ts` の `useMikawaLogic` 分岐・引数・import を削除。給与エンジンは「標準ロジック（固定給/日給/時給）＋ Bluewing ロジック」の2系統に集約。BWの受け入れ基準はユーザー提示の計算例（総支給 270,555円）で、本削除は BW 分岐に非干渉。※ `monthly_records`/`employees` の `salesAmount`/`commissionRate`/`mikawaCommissionRate` カラムと passthrough は NOT NULL insert 失敗回避のため休眠状態で残置（カラム物理削除は drizzle スキーマ移行を伴う別作業）。
- 2026-07-02 `POST /payroll/calculate` に「確定済み（status=confirmed）は再計算で上書きしない」ガードを追加（全計算モード共通、月次レコード確認直後に 409 を返す）。理由: 手入力固定/行ごと計算/保存時自動計算のいずれからも確定済み明細が draft に巻き戻る潜在バグを防止するため。
- 2026-07-02 給与計算エンジン内の「玉川さん専用デバッグ処理」を全削除（`console.log` 群 + 検算用の R7/R8×支援金有無 4パターン再計算 + `enableTrace`/`traceExpectedIncomeTax` の玉川ハードコード + 未使用となった `calculateIncomeTaxReiwa7/8` import）。理由: 本番結果に影響しない無駄な計算・ログで、特定社員名をロジックに埋め込むのはバグの温床のため。
