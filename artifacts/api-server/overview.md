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
- 2026-07-10 給与明細の土曜/日曜（休日）出勤が印刷に出ない不具合を修正。原因は勤怠フィールドの二重帳簿: 月次実績入力は 土曜=`saturdayWorkDays`・日曜/祝日=`sundayWorkDays` に書くが、payroll には土曜日数の列が無く、休日表示は入力に使われない `holidayWorkDays` を保存していた（常に0）。対応: `payrolls` に `saturday_work_days` 列追加、`POST /payroll/:id/calculate` の全3枝（手動/BW/標準）の保存で `saturdayWorkDays=record.saturdayWorkDays`／`holidayWorkDays=record.sundayWorkDays` に是正。標準枝は休日出勤手当の表示行を `holidayPay + sundayPay` に合算（grossSalary は不変、エンジンが既に両者を合算済みのため二重計上なし）。BW枝の holidayPay は元々 sundayWorkDays 由来のため非干渉。過去の確定分は月次実績からの日数バックフィルで表示補完（金額不変）。
- 2026-07-03 運用リスクの是正（オペレーション改善）:
  - **PIN漏洩の修正**: `/employees` の list/get/create/update レスポンスが全カラム（4桁 `pin` 含む）を返していたのを、`sanitizeEmployee()` で `pin` を除去し `hasPin`（設定有無のbool）に置換。PIN値はAPIに一切乗らない。
  - **社員物理削除のガード**: `DELETE /employees/:id` は給与明細/月次実績がある社員に対し 409 を返して物理削除を拒否（賃金台帳等の法定保存記録を保護）。退職は在籍OFF（`isActive=false`＝論理削除）へ誘導。誤登録の空社員のみ物理削除可。
  - **確定解除**: `POST /payroll/:id/unconfirm` を追加（confirmed→draft）。確定後に誤りが見つかった際の訂正導線。`/calculate` の確定ガード（409）と対で運用。
- 2026-07-02 三川ロジックを削除（デッドコード整理・フェーズ1）。フロントの給与計算呼び出しは `useMikawaLogic` を送っておらず未使用だったため、`payroll-calculator.ts` の `calculateMikawaPayroll`/`MikawaPayrollInput`/`MikawaPayrollResult`/`MIKAWA_DAILY_BASE` と、`payroll.ts` の `useMikawaLogic` 分岐・引数・import を削除。給与エンジンは「標準ロジック（固定給/日給/時給）＋ Bluewing ロジック」の2系統に集約。BWの受け入れ基準はユーザー提示の計算例（総支給 270,555円）で、本削除は BW 分岐に非干渉。※ `monthly_records`/`employees` の `salesAmount`/`commissionRate`/`mikawaCommissionRate` カラムと passthrough は NOT NULL insert 失敗回避のため休眠状態で残置（カラム物理削除は drizzle スキーマ移行を伴う別作業）。
- 2026-07-02 `POST /payroll/calculate` に「確定済み（status=confirmed）は再計算で上書きしない」ガードを追加（全計算モード共通、月次レコード確認直後に 409 を返す）。理由: 手入力固定/行ごと計算/保存時自動計算のいずれからも確定済み明細が draft に巻き戻る潜在バグを防止するため。
- 2026-07-13 2026-07-10 の土曜/休日出勤の修正を main にマージし、本番 Neon へ反映（列追加＋既存20件のバックフィル。金額列は不変）。詳細は `lib/db/overview.md`。
  - ※ **BW分岐の二重計上は未修正（仕様として据え置き）**。`calculateBluewingPayroll` の総支給は `固定残業代 + 超過残業代 + 解答B + 業績手当` で、解答B にカスタム手当合計がそのまま入るため、自動計算項目と同名のカスタム手当（早出残業手当/職務手当/休日出勤手当）が登録されていると金額が二重に加算される。実データ（横井 EMP010 2026/6）で確認済み。実運用は全社員を manual モードで確定しており表面化しないため、エンジンは変更せず運用で回避する方針をユーザーと合意（2026-07-13）。エンジンを触るときはこの前提を必ず確認すること。
- 2026-07-02 給与計算エンジン内の「玉川さん専用デバッグ処理」を全削除（`console.log` 群 + 検算用の R7/R8×支援金有無 4パターン再計算 + `enableTrace`/`traceExpectedIncomeTax` の玉川ハードコード + 未使用となった `calculateIncomeTaxReiwa7/8` import）。理由: 本番結果に影響しない無駄な計算・ログで、特定社員名をロジックに埋め込むのはバグの温床のため。
