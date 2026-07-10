# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

運送業向けの給与計算・バックオフィス自動化システム（三川運送）。基本給・残業・深夜・歩合の計算から源泉所得税ルックアップ、振替伝票・会計CSV出力まで一気通貫で行う。

> **`replit.md` is the authoritative domain reference.** It documents the full DB schema, the payroll calculation engine (令和8年 税額表・社会保険料等級), the auth model, mobile-responsive rules, and accounting CSV formats in depth. Read it before touching payroll logic, tax tables, or the schema. This file covers the *big-picture wiring* that spans multiple packages and the non-obvious local-dev setup — it deliberately does not repeat `replit.md`.

## 各階層の overview.md（作業前に読む / 作業後に更新する）

このリポジトリは主要な階層ごとに `overview.md` を持ち、その領域の「これは何か・主要ファイル・現在のステータス・決定事項」を要約している。**その領域のコードを触る前に、対応する `overview.md` を読んで文脈を掴むこと。** また、**その領域に notable な変更（機能追加・設計変更・ステータス変化）を加えたら、作業後に該当 `overview.md` を更新すること**（現在のステータス／決定事項に日付＋理由を追記）。事実とコードに基づき、推測は「※推測」と明記する。

- `docs/overview.md` — プロジェクト全体の概要
- `artifacts/api-server/overview.md` / `artifacts/payroll-app/overview.md`
- `lib/db/overview.md` / `lib/api-spec/overview.md` / `lib/api-client-react/overview.md` / `lib/api-zod/overview.md` / `lib/tax-tables-reiwa8/overview.md`

新しい主要ディレクトリを作ったら、その階層にも `overview.md` を追加する。

## Monorepo layout

pnpm workspaces (`pnpm-workspace.yaml`). Node 24, TypeScript 5.9, `zod/v4`.

- **`artifacts/*`** — deployable apps, each built/run independently:
  - `api-server` (`@workspace/api-server`) — Express 5 API, mounted at `/api`, listens on **port 8080**. Bundled to a single ESM file with esbuild (`build.mjs`), not `tsc`.
  - `payroll-app` (`@workspace/payroll-app`) — React + Vite SPA (wouter router, TanStack Query, Tailwind v4, Radix UI). Dev server **proxies `/api` → `http://localhost:8080`** (see `vite.config.ts`).
  - `mockup-sandbox` — standalone UI mockup playground; not part of the production flow.
- **`lib/*`** — shared packages consumed via `workspace:*` and wired as TS project references (`tsconfig.json` → `tsc --build`):
  - `db` (`@workspace/db`) — Drizzle schema + the pg `Pool`/`db` singleton. **Requires `DATABASE_URL`** at import time.
  - `api-spec` — `openapi.yaml` (the API contract) + Orval codegen config.
  - `api-client-react` / `api-zod` — **generated** output (see below); do not hand-edit `src/generated/`.
  - `tax-tables-reiwa8` — 令和8年 源泉所得税テーブル, shared by **both** backend calculation and frontend preview.

Dependency direction: `payroll-app` → `api-client-react` + `tax-tables-reiwa8`; `api-server` → `db` + `api-zod` + `tax-tables-reiwa8`. Frontend and backend never import each other — they meet only through the OpenAPI contract.

## The API contract is generated — edit the spec, not the output

`lib/api-spec/openapi.yaml` is the single source of truth. Orval regenerates two packages from it (`clean: true`, so generated files are wiped and rewritten each run):

- `lib/api-client-react/src/generated/` — React Query hooks (uses the `custom-fetch.ts` mutator, baseUrl `/api`).
- `lib/api-zod/src/generated/` — Zod schemas used for request/response validation.

After changing an endpoint's shape: edit `openapi.yaml`, then `pnpm --filter @workspace/api-spec run codegen`. Changes to generated files by hand will be lost.

## Commands

```bash
pnpm install                                   # bootstrap (see Windows caveat below)
pnpm run typecheck                             # full typecheck across all packages — the primary correctness gate
pnpm run build                                 # typecheck + build every package
pnpm --filter @workspace/api-spec  run codegen # regenerate API hooks + Zod schemas from openapi.yaml
pnpm --filter @workspace/db        run push    # push Drizzle schema to the DB (dev only; no migration files)
pnpm --filter @workspace/api-server run dev    # build + start the API (needs env vars, see below)
pnpm --filter @workspace/payroll-app run dev   # Vite dev server (needs env vars, see below)
```

**There is no test suite** (no vitest/jest/node:test). `pnpm run typecheck` is the verification step — run it after non-trivial changes.

DB schema changes are applied with `drizzle-kit push` (no generated migration files are committed); the schema in `lib/db/src/schema/` is the source of truth.

## Runtime configuration

The code reads `process.env` directly — **there is no dotenv loader**, so env vars must be present in the launching process's environment, not just a `.env` file.

- **api-server** requires: `PORT`, `DATABASE_URL` (Postgres), `SESSION_SECRET`, and `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL` (Web Push; read at module load in `routes/messages.ts`). Sample VAPID values live in `.replit` under `[userenv.shared]`.
- **payroll-app** requires: `PORT` and `BASE_PATH` (both throw in `vite.config.ts` if missing).

## Auth model (see `replit.md` for the full list)

- Session-based (`express-session`) with the session stored in Postgres via `connect-pg-simple` (`session` table, pre-created by the Drizzle schema — `createTableIfMissing:false`).
- Password hash is `sha256(password + "mikawa_salt")` (`routes/auth.ts`). Accounts live in `system_users`.
- **First-setup bypass:** when `system_users` is empty, the global auth middleware in `routes/index.ts` lets *every* request through. As soon as one user exists, admin routes return 401/403.
- **Public QR flow:** `/driver/:id` and `/office/:id` (frontend, outside `ProtectedRoutes`) hit a fixed allowlist of unauthenticated endpoints — see `isPublicDriverFlowRequest()` in `routes/index.ts`. These trust the `employeeId` in the request; owner enforcement (`lib/auth-middleware.ts`) only kicks in for *logged-in* drivers.

## Where the important logic lives

- Payroll engine: `artifacts/api-server/src/lib/payroll-calculator.ts` + `artifacts/api-server/src/lib/tax-tables-reiwa8.ts` (and the shared `lib/tax-tables-reiwa8`). Tax/insurance values are officially hard-coded for exact 1-yen matching — change them only against the cited 国税庁 / 協会けんぽ sources in `replit.md`.
- API routes: `artifacts/api-server/src/routes/` (mounted under `/api` in `routes/index.ts`, which also applies the prefix-based `requireAdmin` authorization).
- Frontend pages: `artifacts/payroll-app/src/pages/`; auth wiring in `src/context/auth-context.tsx` + `ProtectedRoutes` in `src/App.tsx`.

## Payroll has three calculation branches (one endpoint, `POST /payroll/:id/calculate`)

`routes/payroll.ts` dispatches on the request body **before** touching the tax tables — read all three before changing calc behavior:

1. **manual** (`calculationMode === "manual"`) — nothing is computed; the client-supplied 社会保険/所得税 values are stored as-is. `emp.taxExempt === true` zeroes every deduction. No engine call.
2. **Bluewing** (`useBluewingLogic` in the body **or** `emp.useBluewingLogic`) → `calculateBluewingPayroll`. Persisted with `calculationMode: "bluewing_auto"`.
3. **standard** (default) → `calculatePayroll`, `calculationMode: "auto"`.

Confirmation is a hard gate: if the existing record is `status: "confirmed"`, calculate returns **409**（「確定済みの給与明細は再計算できません。」）. `POST /payroll/:id/confirm` sets `confirmed`; `POST /payroll/:id/unconfirm` reverts to `draft` to allow recalculation. All freshly-written records start as `draft`.

## PIN never leaves the server in the clear

Employee rows carry a 4-digit `pin`. Every employee response goes through `sanitizeEmployee()` in `routes/employees.ts`, which **strips `pin`** and substitutes `hasPin: boolean`. The raw `pin` is only read internally by the verify/status endpoints (`/employees/:id/verify-pin`, `/pin-status`). If you add an employee-returning endpoint, route it through `sanitizeEmployee` too, and expose `hasPin` (not `pin`) in `openapi.yaml`.

## Payslip printing (frontend-only, no PDF backend)

Printing is done entirely in the browser via a React portal + `@media print`, not server-rendered:

- A portal div `#payroll-print-root` is created at print time; `index.css` keeps it `display:none` on screen and only reveals it under `@media print` (this prevents the payslip lingering on screen if `afterprint` doesn't fire). `#root` is hidden while printing.
- **Single** payslip renders fixed-position full-page; **bulk** print sets `data-bulk-print="true"` on the portal, which switches to static/stacked flow so each 明細 is one page (`payslip-bulk-print.tsx`, one `100vh` block per employee, `window.print()` after all allowance/deduction queries resolve).
- **N-up（面付け, several payslips per sheet）is intentionally NOT implemented in-app** — users select the browser print dialog's「1枚あたりのページ数」(pages-per-sheet 4/16). Custom scaling was tried and removed because it always cut content off; do not reintroduce it.
- The classic payslip (`payslip-print-classic.tsx`) de-dups custom allowances whose name collides with a BW auto-computed 手当, and splits 社会保険料 into 健康保険料/厚生年金保険料 for display only (recomputed from `stdRem`, not stored separately).

## Local dev on Windows (non-obvious)

This repo is built and deployed on **Replit (linux-x64)**. Two things bite when running natively on Windows:

1. **Native binaries are stripped for Windows.** `pnpm-workspace.yaml` `overrides` force-remove every non-linux platform binary for `esbuild`, `rollup`, `lightningcss`, and `@tailwindcss/oxide` (including `win32-x64`). With them removed, esbuild/Vite cannot run on Windows. To run natively you must locally remove the `*win32-x64*` (`"…": "-"`) override lines and reinstall — treat this as a local-only change, not something to commit.
2. **Env vars + shells.** Because there's no dotenv, pass env inline. In **Git Bash**, `BASE_PATH=/` gets mangled into a Windows path (`/Program Files/Git/`) — set it from **PowerShell** (`$env:BASE_PATH="/"`) or use `MSYS_NO_PATHCONV=1`. The api-server `dev` script uses `export …` (sh syntax); on Windows run `build` then `start` separately instead of `dev`.

The canonical (Linux/Replit) commands above are unaffected — these caveats are only for a native Windows checkout.
