# artifacts/api-server — 三川運送システムの Express 5 API サーバ（`@workspace/api-server`）

給与計算・勤怠・メッセージ等のバックエンド API。`/api` にマウントし、ポート **8080** で待受。esbuild で単一 ESM にバンドルして起動する（`tsc` ではない）。

> 詳細なドメイン仕様（DBスキーマ・税額/社保計算・認証モデル・公開ルート）は プロジェクトルートの `replit.md` が正典。ここでは api-server 内部の地図だけを書く。

## 主要ファイル

- `src/index.ts` — エントリポイント
- `src/app.ts` — Express アプリ構築
- `src/routes/index.ts` — 全ルートを `/api` にマウント。prefix ベースの `requireAdmin` 認可、公開フロー判定 `isPublicDriverFlowRequest()`
- `src/routes/*.ts` — 機能別ルート（`auth`, `employees`, `payroll`, `monthly_records`, `attendance`, `allowances`, `absences`, `calendar`, `company`, `dashboard`, `journal_entries`, `messages`, `users`, `health`）
- `src/lib/payroll-calculator.ts` — 給与計算エンジン（基本給/残業/深夜/歩合/源泉税/社保）
- `src/lib/tax-tables-reiwa8.ts` — 令和8年テーブル（共有 lib のラッパ）。値変更は要出典。`calculateInsuranceAndTax` は `insuranceRates`（本人負担率）を受け取れる（省略時は令和8年度の内蔵値）
- `src/lib/insurance-settings.ts` — 保険料率マスター・標準報酬月額の履歴から「給与明細の年月」に効く値を解決（`getEffectiveInsuranceRates` / `getEffectiveStandardRemuneration`）。料率の表が空なら初期行を作る
- `src/routes/insurance.ts` — 保険料率マスター（`/insurance-rate-periods`、`/insurance-rates/effective`）と標準報酬月額の履歴（`/employees/:id/standard-remuneration-history`、`/standard-remuneration/effective`、`/standard-remuneration/bulk`）
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

- 2026-09-14 **社会保険・雇用保険の料率と標準報酬月額を、年度ごとにマスターで切り替えられるようにした**（ユーザー依頼：定時決定（R8.9適用）の通知書や料率改定のたびに、過去の月の計算を変えずに新しい値へ切り替えたい）。
  - 以前: 健保9.85%・介護1.62%・支援金0.23%・厚年18.3% はプログラムに直書き、子ども・子育て支援金の開始（2026年4月の明細〜）は `isChildcareSupportApplicable()` に直書き、雇用保険は会社設定の1値、標準報酬月額は社員マスタの1値で、どれも履歴が無かった。値を書き換えるとそれ以降に計算する全ての月に効き、「9月分から変える」ができなかった。
  - 仕様: 新テーブル `insurance_rate_periods`（料率の履歴）と `standard_remuneration_history`（社員ごとの標準報酬月額の履歴）。**適用開始は給与明細の年月**（`payrolls.year/month`）で数え、「その月以前でいちばん新しい行」を使う。料率は保険料額表の「合計」の率で持ち本人負担は半分にする（雇用保険だけ本人負担の率）。標準報酬月額は該当する履歴が無い月は社員マスタの値（初期値）を使う。
  - 3つの計算分岐（manual / BW / 標準）すべてがこの値を使う。計算に使った標準報酬月額と料率を `payrolls.applied_*` に複写（明細印刷の健保・厚年の内訳もこれを使う）。
  - 移行: 料率の表が空なら初回アクセス時に初期行を2行作る（2000年1月〜: 支援金0%、2026年4月〜: 支援金0.23%。雇用保険は会社設定の値）。**既存の計算結果を変えないため、本番の雇用保険料率 0.0005 もそのまま引き継ぐ**（正しい値は社労士に確認のうえ画面で直す）。
  - 検証: 変更前のビルドと変更後のビルドを同じ検証DBで並べ、社員条件4種（標準報酬あり・未設定、厚年上限超え・70歳以上、全額非課税・雇保対象外）× BW有無 × 3/8/9/10月 × manual/auto の112件を比較し、**2026年4月以降は全項目一致**。2026年3月（支援金の開始前）の8件だけ源泉所得税が 70〜110円高くなる：旧コードは支援金を0円にする前に「支援金を控除した額」で所得税を出していたため（実際には引いていない支援金で税を下げていた）。新コードは支援金0%で最初から計算するので正しい。※本番には 2026年3月の下書きが9件あり、再計算するとこの差が出る。API検証47項目・画面検証53項目も全通過。

- 2026-09-09 `POST /payroll/calculate` の `calculationMode` は、指定が無ければ既存明細のモードを引き継ぐようにした（従来は既定で "auto"）。月次実績入力の「実績を保存」がモードを送らないため、事務所が manual で組み立てた明細が BW/標準の自動計算で上書きされ、手当ベースの支給額が消えていた（2026-08 の明細が実際に manual → bluewing_auto に化けていた）。既存明細が無い新規のときだけ "auto" にフォールバックする。
- 2026-09-06 `lateNightPremiumPerHour()` の端数を切り捨て→四捨五入に変更。事務所の手計算（2,111円/h→422、1,750→350、1,909→382）と一致するのは四捨五入のみ。BW分岐・標準計算の深夜手当が対象で、影響は1円単位。
- 2026-08-26 有給休暇を日数管理に:
  - `monthly_records.paid_leave_days` / `payrolls.paid_leave_days` を追加。月次実績で日数を入力し、手当「有給」の金額は 日当 × 日数 で導出する（従来は事務所が「日数 × 平日日当9,808」を電卓で出して金額欄に手入力しており、手当が年月を持たないため前月の金額が翌月に残っていた。実データで平良58,848=6日分・古田29,424=3日分…と9名分が9,808の倍数だったことを確認）。
  - **有給を欠勤控除の対象から外した。** `paid_leave` は元々 `ABSENCE_DAYS` に定義された欠勤種別で、`GET /attendance/monthly-summary` が全種別を `absenceDays` に合算していたため、勤怠カレンダーで有給を登録すると `absenceDeduction = 日当 × 日数` で1日分引かれていた（有給なのに控除）。集計を分離し `paidLeaveDays` を別に返す。本番の有給登録は1件のみ（2026-04-30）で実害は出ていなかった。
- 2026-08-26 クライアント報告「残業・深夜の時間を入れると金額がズレる」の是正と、日曜出勤の時間計算化:
  - **深夜手当が個人残業時給を無視していた**（標準計算のみ）。`calculatePayroll` の深夜手当は `基本給 ÷ 月平均労働時間 × 0.25` だったため、基本給を0にして手当中心で運用している社員は深夜手当が常に0円になっていた（実データ: 玉川で深夜2.5h入力→0円）。BW分岐は元々「残業単価 ÷ 1.25 × 0.25」を使っており、これを `lateNightPremiumPerHour()` として切り出して両分岐で共有。個人残業時給が設定されている社員はこちらを使う（2,111円/h→422円/h、1,750円/h→350円/h）。
  - **支給額の端数処理を四捨五入に変更**（`roundPayYen`）。`roundJapanese` は「50銭以下切り捨て」＝社会保険料の通達ルールで、39.5h × 2,111円 = 83,384.5 → 83,384 となり事務所の手計算（83,385）と1円ズレていた。BW分岐は元々 `Math.round`。**対象は残業手当・日曜出勤手当のみ**で、保険料・税・総支給の `roundJapanese` は1円完全一致要件のため不変。
  - **日曜・祝日出勤を日数計算から時間計算へ**（クライアント依頼）。`sundayPay = 会社設定 hourlyWageSunday（既定1,655円/h） × monthly_records.sundayWorkHours`。旧式は `日当 × 1.35 × 日数`。BW分岐の holidayPay も `土曜日当 × 日数` から同式に変更。`payrolls.holidayWorkHours` に表示用スナップショットを保存（3経路すべて）。`GET /attendance/monthly-summary` に日曜の実働時間 `sundayWorkHours` を追加。
  - ※ **本番反映には NAS 側で `drizzle-kit push` が別途必要**（`monthly_records.sunday_work_hours` / `payrolls.holiday_work_hours`）。既存の月次実績は sundayWorkHours=0 で入るため、8月分の日曜出勤は時間で入れ直しが要る。
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

- 2026-10-24 ドライバー側と勤怠の見直し（30項目・DB の変更は `deploy/migrations/2026-10-24-batch-b.sql`）:
  - **勤務の区切り**は `lib/shift.ts` に集約。出勤以外の打刻は「直近24時間以内の出勤で、まだ退勤していない勤務」に付ける（朝5時の区切りは廃止）。打刻・today・draft・checklist・stream・一覧・地図が同じ関数を使う。押す順番の確認・休憩中の退勤で休憩終了を自動で足す・同時押しは `pg_advisory_xact_lock` と部分一意インデックスで防ぐ。
  - 打刻ごとの `client_id` で二重送信を捨てる（電波が戻ってからの送信は端末の時刻を24時間以内なら採用＝`source='offline'`）。取り消し・管理画面の削除は消さずに `voided_at` を付け、`attendance_record_logs` に残す。
  - 月の集計（`monthlySummary`）：分のまま足して月で丸める・深夜（22〜5時）・土日祝の8時間超（`restDayOvertimeHours`）・打ち忘れの一覧・休みと出勤の重なり。事務員の30分切り上げは `attendance_settings.officeRounding`（既定＝これまでどおり）。
  - 新しい表：修正申請・日常点検（1人1日1件）と履歴・アルコールチェック（社員を消しても残す）・日報・勤怠の設定。経路は `routes/attendance-extra.ts`。改善基準告示の目安は `lib/compliance.ts`、お知らせは `lib/alerts-attendance.ts`（`computeAlerts` から呼ぶ）、毎朝の打ち忘れの知らせは `startAttendanceJobs()`。
  - メッセージは先に返事をしてから通知を送る（`client_id` で二重送信を捨てる）。SSE の心拍は `event: ping`（画面が切れたことに気づいてつなぎ直すため）。

- 2026-10-24 `routes/office_tools.ts` を追加（すべて /office-tools 配下・requireAdmin。閲覧のみは GET だけ）。`month-status`（社員ごとの実績・明細・前月・要再計算の理由＝明細の更新日時より後に実績・手当・社員・会社設定・保険料率・標準報酬・手当マスターが変わったか）、`draft-payrolls`、振込口座 `bank-accounts/:id`、振込元 `transfer-settings`、振込一覧 `transfer`、全銀協フォーマット `transfer/zengin`（`lib/zengin.ts`・120バイト固定長・JIS X 0201 半角・確定済みだけ）。口座番号は操作の記録に残さない（AUDIT_SKIP に入れ、ルート側で下3桁だけ記録）。
- 2026-10-24 `routes/monthly_records.ts` の POST/PUT は、その社員のその月の明細が確定済みなら 409 で断る（確定した金額と勤怠が食い違わないように）。お知らせの href に `?y=&m=&emp=` を付けた（`lib/alerts.ts`）。
