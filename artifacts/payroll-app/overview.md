# artifacts/payroll-app — 三川運送システムのフロントエンド SPA（`@workspace/payroll-app`）

React 19 + Vite 7 のシングルページアプリ。給与計算・勤怠・メッセージ等の管理画面と、QR 経由の公開ドライバー/事務所フローを提供する。開発サーバは `/api` → `http://localhost:8080` をプロキシ。

> ドメイン仕様（画面ごとの計算・モバイル対応の詳細）は プロジェクトルートの `replit.md` が正典。ここでは payroll-app 内部の地図だけを書く。

## 主要ファイル

- `src/main.tsx` / `src/App.tsx` — エントリと `ProtectedRoutes`（wouter ルーティング）
- `src/context/auth-context.tsx` — `AuthProvider` / `useAuth()`
- `src/pages/` — 画面
  - 管理: `dashboard`, `payroll/`（`list`/`detail`）, `monthly-input`, `attendance`, `allowances`, `calendar`, `journal`, `messages`, `users`, `settings`, `login`
  - 公開フロー: `driver`, `office`（`ProtectedRoutes` の外）
  - その他: `realtime-map`（Leaflet 位置マップ）, `not-found`
- `src/components/` — 共有 UI（Radix ベース）
- `src/hooks/`, `src/lib/`, `src/index.css`
- `vite.config.ts` — `PORT` / `BASE_PATH` 必須（未設定で throw）、`/api` プロキシ設定

## スタック・依存

- React 19 / Vite 7 / wouter（router）/ TanStack Query（取得）
- UI: Tailwind CSS v4 + Radix UI + CVA + tailwind-merge + lucide-react
- フォーム: react-hook-form + @hookform/resolvers、グラフ: recharts
- 地図: leaflet / react-leaflet、QR: react-qr-code、アニメ: framer-motion
- ワークスペース依存: `@workspace/api-client-react`（生成フック）, `@workspace/tax-tables-reiwa8`（プレビュー計算）
- バックとは直接 import せず、生成された API クライアント経由

## コマンド

- 型チェック: `pnpm --filter @workspace/payroll-app run typecheck`
- 開発: `pnpm --filter @workspace/payroll-app run dev`（要 env: `PORT` `BASE_PATH`。Windows は PowerShell で `$env:BASE_PATH="/"`）
- ビルド: `pnpm --filter @workspace/payroll-app run build`

## 現在のステータス

- 実装済み: 上記画面群・認証ラッパ・公開QRフロー・リアルタイムマップ・モバイルレスポンシブ
- 未実装/弱点: （要記入）

## 決定事項

- 2026-07-02 このファイル作成（payroll-app 階層の overview 初版）
- 2026-07-02 月次実績入力を「保存して計算」に統一。従来は保存時に **Bluewing 社員だけ** 裏で給与計算していた（結果は給与明細の一括計算で上書きされ二重計算・非一貫）ため削除し、保存した全社員を続けて `POST /payroll/calculate`（`employeeId/year/month` のみ渡しBW判定はサーバに一任）で計算する方式に変更。確定済みはサーバが 409 で弾くため無視。ボタン文言も「保存して計算」に変更。
- 2026-07-02 給与明細一覧（`payroll/list.tsx`）の `useListPayrolls`/`useListEmployees` から `staleTime:0 / refetchOnMount:"always"` を除去（計算・確定後は `invalidateQueries` で明示再取得しており毎マウント強制リフェッチは不要）。副次的に既存の型エラー2件も解消。行ごと計算ボタンの文言を「月次実績から計算」→「この社員のみ再計算」に変更し一括計算との役割を明確化。
- 2026-07-02 マスター管理（`allowances.tsx`）の「計算に反映されない入力」を整理。(A) 計算テーブルマスターの健康保険/介護/厚生年金の各料率・雇用保険会社負担率・残業/深夜/休日割増率は、給与エンジンが令和8年公式値をハードコードしており未使用のため、`disabled` の参考表示に変更（実際に反映されるのは雇用保険本人負担率と月平均労働時間のみ、と明示）。(B) 社員マスターの healthInsuranceMonthly / pensionMonthly / incomeTaxMonthly の「手動上書き」欄はツールチップで「手動優先」と謳うが backend が一切読まないため、schema/デフォルト/reset/UI から完全削除（自動計算に一本化する旨の注記に置換）。(D) `useListEmployees` の `staleTime:0/refetchOnMount:true` を除去（既存の queryKey 型エラーも解消）。(F) 一覧の sortOrder 表示を編集フォームと揃えて `Math.max(1, …)` に統一。理由: 「入力・保存できるのに計算へ反映されない」項目は誤った期待と事故を招くため。
- 2026-07-02 三川ロジック関連UIを削除（デッドコード整理・フェーズ1）。`allowances.tsx` の「三川歩合率（%）」フィールド（schema/デフォルト/reset/submit/UI）、`monthly-input.tsx` の `mikawaCommissionRate` 由来 seeding と保存 payload の `salesAmount`/`commissionRate`、`components/monthly-input/estimate.ts` の `mikawaCommissionRate` 型・データ有無判定の `salesAmount` を除去。月次実績の入力UI（RecordForm）は既に売上/歩合%欄を持たずBW売上のみのため変更なし。新規 typecheck エラーは追加していない（残る `allowances.tsx` 2件は既存の `salaryType:"hourly"` 生成型ドリフト）。
- 2026-07-02 マスターUI簡素化（フェーズ2-②、実態4パターン=BW/固定給/事務員(時給)/日給 に合わせる）。(1) 「歩合単価（円/km・円/件）」は未使用のため社員フォームから削除（schema/デフォルト/reset/UI。歩合設定セクションごと除去）。(2) 表示の出し分けを実装: 個人単価設定（平日/土曜日当・残業時給・高度な残業単位）は日給制のときのみ表示、ブルーウィング設定の各フィールドは「BWロジック使用」トグルON時のみ表示（トグル自体は常時表示）。就労時間（開始/終了・未定）は打刻の遅刻/残業判定に使うため存置。
- 2026-07-02 固定手当のレガシー表示を除去（表示層のみ／ユーザー判断）。固定手当6種は設定UIが無く常に0のため、給与エンジン（1円一致の核）には触れず**表示だけ**を整理:
  - `payslip-print-classic.tsx`: 交通費・無事故・長距離・役職・家族の表示行を BW/標準の両分岐から除去。
  - `payroll/detail.tsx`: 常に¥0で出ていた通勤・無事故・長距離・役職の行を除去。
  - ※ `earlyOvertimeAllowance` は BW では固定残業代（`bluewingFixedOvertimeAmount`）として非0の実値が入るため**存置**。
  - ※ エンジン・DBカラム・openapi はそのまま（値0で無害）。将来カスタム手当へ完全移行する場合の残タスク。
- 2026-07-03 計算テーブルマスターを①②に再構築（「編集できる見た目なのに計算に効かない」問題の根治）。`allowances.tsx` の `CalcTableMasterTab` を全面書き換え:
  - **① 適用中の税・保険基準（令和8年度）**: 健保/介護/厚年/子育て支援金の料率・割増率・源泉（月額表甲欄）を**読み取り専用**で表示。値はフロント共有 `@/lib/tax-tables-reiwa8` に新設した R8 定数（`HEALTH_EMPLOYEE_RATE_R8` 等、バックエンド定数のミラー）を単一の源として参照。手打ちの `TAX_BRACKETS` 抜粋表は撤去。
  - **② 運用パラメータ**: 実際に計算へ効く `monthlyAverageWorkHours` と `employmentInsuranceRate` のみ編集可。日給単価は会社設定(settings)に一本化（重複回避、相互に案内文を掲示）。
  - **プレビュー統一**: `components/monthly-input/estimate.ts` の概算計算を、company の可変料率参照から R8 定数＋標準報酬月額等級表（`calculateInsuranceByGrade`）に変更。これで「プレビュー≠確定給与」の乖離要因を解消。
  - `settings.tsx` の案内文を実態（料率は内蔵・参照専用、編集は月平均労働時間/雇用保険率のみ）に更新。
- ※ payroll-app パッケージは本変更以前から typecheck 未通過（`Company` 生成型に `dailyWageWeekday` 等が無い・`salaryType` から `"hourly"` が消えている等、進行中リファクタ由来の既存エラー多数）。本変更は新規エラーを追加していない。
