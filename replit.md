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
- `monthly_records` — 月次実績（出勤日数、残業時間、深夜時間、走行距離、配送件数等）
- `payrolls` — 給与計算結果（各支給項目・控除項目・差引支給額・カスタム手当合計）
- `journal_entries` — 振替伝票（自動生成）
- `allowance_definitions` — カスタム手当マスタ（名称・課税区分・calculationType・表示順・有効フラグ）
  - calculationType: 'fixed'（固定給型）| 'variable'（変動入力型）| 'unit_time'（単価×時間型）
- `employee_allowances` — 社員別カスタム手当金額（社員×手当定義×金額）

## Payroll Calculation Engine

`artifacts/api-server/src/lib/payroll-calculator.ts`

- 時間外手当: (基本給 ÷ 月平均労働時間) × 1.25 × 残業時間
- 深夜手当: (基本給 ÷ 月平均労働時間) × 0.25 × 深夜時間
- 歩合給: 走行距離 × km単価 + 件数 × 件単価
- 源泉所得税: 国税庁月額表甲欄ロジック（社会保険控除後、扶養人数考慮）
- 端数処理: 50銭以下切り捨て、50銭超え切り上げ

## Accounting CSV Output

Supports: 弥生会計, freee, マネーフォワード, generic

## Key Architecture Notes

- OpenAPI spec: `lib/api-spec/openapi.yaml`
- Generated API hooks: `lib/api-client-react/src/generated/`
- DB schema: `lib/db/src/schema/`
- API routes: `artifacts/api-server/src/routes/`
- Frontend pages: `artifacts/payroll-app/src/pages/`
