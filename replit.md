# 給与明細・バックオフィス効率化システム

## Overview

運送業特化型の給与計算・バックオフィス自動化クラウドシステム。基本給・残業・深夜・歩合給の計算から、源泉所得税自動ルックアップ、振替伝票出力まで一気通貫で行う。

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifact: `payroll-app`, preview path: `/`)
- **API framework**: Express 5 (artifact: `api-server`, path: `/api`)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Database Schema

- `company` — 会社マスタ（締め日、支払日、月平均労働時間、社会保険料率、残業割増率等）
  - 新フィールド: healthInsuranceEmployeeRate, healthInsuranceEmployerRate, pensionEmployeeRate, pensionEmployerRate, employmentInsuranceEmployerRate, overtimeRate, lateNightAdditionalRate, holidayRate
- `employees` — 社員マスタ（基本給、各手当、扶養人数、住民税、歩合単価等）
  - 新フィールド: hasSpouse（配偶者の有無）, healthInsuranceMonthly（健保月額固定）, pensionMonthly（厚年月額固定）, employmentInsuranceApplied（雇保適用）
  - 個人単価3項目: `dailyRateWeekday`（㊥ 平日日当）/ `dailyRateSaturday`（㊡ 休日日当）/ `overtimeHourlyRate`（㊨ 残業時給）。0=会社共通単価を使用。
  - `dailyRateOverride` は廃止（カラムは互換のため残置、コードでは未参照）
- `monthly_records` — 月次実績（出勤日数、残業時間、深夜時間、走行距離、配送件数等）
  - 新フィールド: `actualWorkHours`（時給制事務員用：30分切り上げ後の月間実働時間）
- `payrolls` — 給与計算結果（各支給項目・控除項目・差引支給額・カスタム手当合計）
- `journal_entries` — 振替伝票（自動生成）
- `allowance_definitions` — カスタム手当マスタ（名称・課税区分・calculationType・表示順・有効フラグ）
  - calculationType: 'fixed'（固定給型）| 'variable'（変動入力型）| 'unit_time'（単価×時間型）
- `employee_allowances` — 社員別カスタム手当金額（社員×手当定義×金額）
- `attendance_records` — 打刻記録（employeeId, eventType: clock_in|clock_out|break_start|break_end, workDate, recordedAt）
- `messages` — メッセージ（employeeId, sender: 'office'|'employee', content, readAt）
- `push_subscriptions` — プッシュ通知購読（employeeId, role: 'office'|'employee', endpoint, p256dh, auth）

## Payroll Calculation Engine

`artifacts/api-server/src/lib/payroll-calculator.ts`
`artifacts/api-server/src/lib/tax-tables-reiwa8.ts`（令和8年テーブル）

- **時給制（hourly）**: baseSalary（社員マスタ）= 時給単価。基本給 = 時給単価 × actualWorkHours（30分切り上げ済み実働時間）
- **日給制個人単価オーバーライド**: employees.dailyRateOverride > 0 の場合、会社共通日当を上書き（例: 清水 13,000円/日）
- **残業単位計算**: employees.overtimeUnitMinutes & overtimeUnitRate 設定時、標準計算の代わりに `ceil(残業分 / 単位分) × 単位単価` で計算（例: 清水 10分単位 × 2,031円）
- 時間外手当: (基本給 ÷ 月平均労働時間) × 1.25 × 残業時間
- 深夜手当: (基本給 ÷ 月平均労働時間) × 0.25 × 深夜時間
- 歩合給: 走行距離 × km単価 + 件数 × 件単価
- 源泉所得税: **令和8年 国税庁月額表甲欄（公式テーブル参照方式）**
  - 共有ライブラリ `lib/tax-tables-reiwa8` (`@workspace/tax-tables-reiwa8`) 使用
  - 公式値ハードコード＋数式補完で1円単位の完全一致を実現
  - calibration補正方式を廃止（令和8年版のみ）
  - 扶養親族等の数 = dependentCount + (hasSpouse ? 1 : 0)
  - 出典: 国税庁 令和8年分 給与所得の源泉徴収税額表（月額表）甲欄
- 社会保険料（健保・厚年）: **令和8年協会けんぽ東京支部 標準報酬月額等級テーブル方式**
  - 健康保険料率: 9.85%（折半 4.925%）
  - 厚生年金保険料率: 18.300%（折半 9.150%）
  - 標準報酬月額上限: 厚生年金 650,000円 / 健康保険 1,390,000円
  - 社員マスタに手動設定（healthInsuranceMonthly / pensionMonthly）がある場合は優先
- 端数処理: 50銭以下切り捨て、50銭超え切り上げ

## Accounting CSV Output

Supports: 弥生会計, freee, マネーフォワード, generic

## Authentication

- セッションベース認証（express-session）
- **セッションストア: PostgreSQL（`session` テーブル, `connect-pg-simple`）** — APIサーバー再起動でログアウトされない
- パスワードハッシュ: `sha256(password + "mikawa_salt")`
- セッション有効期間: 8時間（cookie maxAge = 8h、期限切れ削除を1時間ごとに実施）
- `system_users` テーブルでアカウント管理（ユーザー管理画面から追加・変更可能）
- ユーザーが0件の場合、認証なしで全ルートにアクセス可能（初回セットアップ用バイパス）
- フロントエンド: `AuthProvider` → `useAuth()` hook → ProtectedRoutes ラッパー
- バックエンド: `artifacts/api-server/src/routes/auth.ts`（login/logout/me）
- パスワードリセット: ユーザー管理画面（/users）から「編集」で変更可能

### 公開ルート（ログイン不要）

QRコード読み取りで遷移する打刻ページは公開フロー：
- フロント: `/driver/:id`, `/office/:id` は `ProtectedRoutes` の外側
- バックエンド: `routes/index.ts` の `isPublicDriverFlowRequest()` で以下を無認証通過
  - `GET /employees/:id`, `GET /employees/:id/pin/status`, `POST /employees/:id/pin/verify`
  - `POST /attendance/record`, `POST /attendance/location/live`
  - `GET /attendance/employee/:id/today`, `GET /attendance/employee/:id/month`
  - `GET|PATCH /attendance/checklist/:id`, `GET|PATCH /attendance/draft/:id`
  - SSE: `GET /attendance/stream`, `GET /messages/stream`
  - Push: `GET /messages/vapid-public-key`, `POST /push/subscribe`
  - `GET /messages/:id`, `GET /messages/:id/unread-count`, `POST /messages/:id/read`, `POST /messages`
- 注意: 未ログイン公開エンドポイントは body/URL の employeeId をそのまま採用するため、ID推測で他人の打刻・メッセージ操作が可能（元仕様）。本格的な本人性担保は既存の PIN 検証フロー（`POST /employees/:id/pin/verify`）または将来のフェーズで強化予定
- 管理機能（`/payroll`, `/employees`一覧, `/users`, `/monthly-records`, `/dashboard`, `/journal-entries` 等）は引き続き 401/403 で防御
- `requireOwnerOrAdmin` / `requireAttendanceRecordOwnerOrAdmin` は **未ログインは通過、ログイン中ドライバーは本人のみ通過** という挙動。これによりログイン中ドライバーが他人になりすますことは引き続き防止される

## Mobile Responsive Implementation

- **AppLayout**: ハンバーガーメニュー（モバイル）、サイドバーオーバーレイ、`pb-20 md:pb-6` でフッター高さ確保
- **MobileBottomNav**: `fixed bottom-0 … md:hidden` — 5ボタン（ホーム/月次実績/給与明細/勤怠管理/メッセージ）、未読バッジ付き
- **Sidebar**: `onClose` prop追加、モバイル閉じるボタン
- **Dashboard**: `lg:grid-cols-7` 対応、ヘッダーのYear/Month Selectがモバイル幅で縮小
- **Payroll List**: モバイル=カードリスト（`sm:hidden`）、デスクトップ=テーブル（`hidden sm:block`）
- **Messages**: `mobileView` state（list/chat切り替え）、チャット画面に「戻る」ボタン
- **Attendance**: ヘッダーを `flex-col sm:flex-row`、サマリーカードを `grid-cols-2 sm:grid-cols-4`
- **Monthly Input**: テーブルは既存の `overflow-x-auto` を維持
- **Allowances**: タブラベルをモバイルで短縮、社員テーブルをモバイルカードリスト化
- **Calendar**: ヘッダーを `flex-col sm:flex-row`
- **Attendance Date Picker**: カレンダー幅 `w-[min(380px,calc(100vw-16px))]`、ボタンクリック時に左位置をビューポート内クランプ
- **Realtime Map**: モバイルは地図全画面 + 浮遊リストボタン → `Sheet`（ボトムシート、`h-[85dvh]`）。`EmployeePanel`/`Legend` サブコンポーネントでデスクトップ・モバイル両方で再利用。フローティング要素は `z-[800]`（Leafletのpopup/tooltipより上）

## Key Architecture Notes

- OpenAPI spec: `lib/api-spec/openapi.yaml`
- Generated API hooks: `lib/api-client-react/src/generated/`
- DB schema: `lib/db/src/schema/`
- 源泉所得税テーブル: `lib/tax-tables-reiwa8/src/index.ts`（バック・フロント共有）
- API routes: `artifacts/api-server/src/routes/`
- Frontend pages: `artifacts/payroll-app/src/pages/`
