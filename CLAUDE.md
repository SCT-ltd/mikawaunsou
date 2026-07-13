# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

運送業向けの給与計算・バックオフィス自動化システム（三川運送）。基本給・残業・深夜・歩合の計算から源泉所得税ルックアップ、振替伝票・会計CSV出力まで一気通貫で行う。

> **`replit.md` is the authoritative *domain* reference.** It documents the full DB schema, the payroll calculation engine (令和8年 税額表・社会保険料等級), the auth model, mobile-responsive rules, and accounting CSV formats in depth. Read it before touching payroll logic, tax tables, or the schema.
>
> The name is a leftover: **the project no longer runs on Replit** (the `.replit` config has been deleted and the platform-specific tooling removed). Treat `replit.md` purely as the domain spec — anything it says about *running or deploying on Replit* is obsolete; this file is authoritative for the dev setup.

## 各階層の overview.md（作業前に読む / 作業後に更新する）

このリポジトリは主要な階層ごとに `overview.md` を持ち、その領域の「これは何か・主要ファイル・現在のステータス・決定事項」を要約している。**その領域のコードを触る前に、対応する `overview.md` を読んで文脈を掴むこと。** また、**その領域に notable な変更（機能追加・設計変更・ステータス変化）を加えたら、作業後に該当 `overview.md` を更新すること**（現在のステータス／決定事項に日付＋理由を追記）。事実とコードに基づき、推測は「※推測」と明記する。

- `docs/overview.md` — プロジェクト全体の概要
- `artifacts/api-server/overview.md` / `artifacts/payroll-app/overview.md`
- `lib/db/overview.md` / `lib/api-spec/overview.md` / `lib/api-client-react/overview.md` / `lib/api-zod/overview.md` / `lib/tax-tables-reiwa8/overview.md`
- `deploy/overview.md` — 本番デプロイ（NAS + Cloudflare Tunnel）

新しい主要ディレクトリを作ったら、その階層にも `overview.md` を追加する。

## Monorepo layout

pnpm workspaces (`pnpm-workspace.yaml`). Node 24, TypeScript 5.9, `zod/v4`.

- **`artifacts/*`** — deployable apps, each built/run independently:
  - `api-server` (`@workspace/api-server`) — Express 5 API, mounted at `/api`, listens on **port 8080**. Bundled to a single ESM file with esbuild (`build.mjs`), not `tsc`.
  - `payroll-app` (`@workspace/payroll-app`) — React + Vite SPA (wouter router, TanStack Query, Tailwind v4, Radix UI). Dev server **proxies `/api` → `http://localhost:8080`** (see `vite.config.ts`).
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

**A field the API already returns is still invisible to the frontend until it's in the spec.** `buildPayrollResponse()` spreads the whole DB row, so new payroll columns reach the client at runtime but are absent from the generated `Payroll` type — TS then rejects `payroll.newField`. Add it to `openapi.yaml` and re-run codegen rather than casting around the type.

## Commands

```bash
pnpm install                                   # bootstrap (Windows: run from Git Bash — see below)
pnpm run typecheck                             # full typecheck across all packages — the primary correctness gate
pnpm run build                                 # typecheck + build every package
pnpm --filter @workspace/api-spec  run codegen # regenerate API hooks + Zod schemas from openapi.yaml
pnpm --filter @workspace/db        run push    # push Drizzle schema to the DB (dev only; no migration files)

pwsh -File scripts/dev.ps1                     # ← local dev: loads .env.local, builds+starts the API, then Vite
```

`scripts/dev.ps1` is the local launcher (it replaced the Replit run button). It reads `.env.local`, builds and starts the api-server on `PORT` (8080), then runs the Vite dev server on `FRONT_PORT` (5173). To run the two halves separately, export the env vars yourself and use `pnpm --filter @workspace/api-server run build && … run start` and `pnpm --filter @workspace/payroll-app run dev`.

**There is no test suite** (no vitest/jest/node:test). `pnpm run typecheck` is the verification step — run it after non-trivial changes.

DB schema changes are applied with `drizzle-kit push` (no generated migration files are committed); the schema in `lib/db/src/schema/` is the source of truth.

## Runtime configuration

The code reads `process.env` directly — **there is no dotenv loader**, so env vars must be present in the launching process's environment. `.env.local` (gitignored) holds them and is loaded by `scripts/dev.ps1`; nothing else reads it.

- **api-server** requires: `PORT`, `DATABASE_URL` (Postgres — currently a managed **Neon** instance), `SESSION_SECRET`, and `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL` (Web Push; read at module load in `routes/messages.ts`).
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

## Payroll has three calculation branches (one endpoint, `POST /payroll/calculate`)

`routes/payroll.ts` dispatches on the request body **before** touching the tax tables — read all three before changing calc behavior:

1. **manual** (`calculationMode === "manual"`) — nothing is computed; the client-supplied 社会保険/所得税 values are stored as-is, and every auto-computed pay field (`overtimePay`, `saturdayPay`, `holidayPay`, `performanceAllowance`, …) is written as **0**, so 総支給 = 基本給 + カスタム手当. `emp.taxExempt === true` zeroes every deduction. No engine call. **This is the mode the office actually confirms payslips in.**
2. **Bluewing** (`useBluewingLogic` in the body **or** `emp.useBluewingLogic`) → `calculateBluewingPayroll`. Persisted with `calculationMode: "bluewing_auto"`.
3. **standard** (default) → `calculatePayroll`, `calculationMode: "auto"`.

Confirmation is a hard gate: if the existing record is `status: "confirmed"`, calculate returns **409**（「確定済みの給与明細は再計算できません。」）. `POST /payroll/:id/confirm` sets `confirmed`; `POST /payroll/:id/unconfirm` reverts to `draft` to allow recalculation. All freshly-written records start as `draft`.

### 二重計上のワナ（Bluewing 分岐）

`calculateBluewingPayroll` の総支給は `固定残業代 + 超過残業代 + 解答B + 業績手当` で、**解答B にはカスタム手当の合計がそのまま入る**。そのため「早出残業手当」「職務手当」「休日出勤手当」といった**自動計算項目と同名のカスタム手当が社員に登録されていると、金額が二重に加算される**（自動計算分＋カスタム手当分）。実運用では事務所が全項目をカスタム手当として入力し manual モードで確定しているため表面化しないが、BW 自動計算のまま確定すると総支給が過大になる。`allowance-input-panel.tsx` は同名手当を検知して警告を出す。計算ロジックを触るときはここを最初に確認すること。

### 勤怠日数は「表示用」に給与レコードへも複写される

`payrolls` の `workDays` / `saturdayWorkDays` / `holidayWorkDays` / `overtimeHours` / `lateNightHours` は明細印刷のための**スナップショット**（金額計算には使わない）。保存時のマッピングに注意:

- `payrolls.holidayWorkDays` ← `monthly_records.**sundayWorkDays**`（テーブルの「日曜/祝日」列）。`monthly_records.holidayWorkDays` は使われていないレガシー列。
- `payrolls.saturdayWorkDays` ← `monthly_records.saturdayWorkDays`。

4つの保存経路（manual / BW / standard ×2）すべてで複写しているので、勤怠項目を足すときは4箇所すべてを更新すること。

### 分単位の残業入力（社員ごと）

社員に `overtimeUnitMinutes` / `overtimeUnitRate` が設定されている場合（例: 10分単位 × 2,031円）、月次入力の UI は**「回」**で入力させるが、DB には**時間に換算して**保存する（19回 → `19 × 10 / 60 = 3.1666…` 時間）。表示時は必ず `formatHours()`（`src/lib/format.ts`）を通すこと — 生の値を出すと `3.1666666666666665時間` になる。

## PIN never leaves the server in the clear

Employee rows carry a 4-digit `pin`. Every employee response goes through `sanitizeEmployee()` in `routes/employees.ts`, which **strips `pin`** and substitutes `hasPin: boolean`. The raw `pin` is only read internally by the verify/status endpoints (`/employees/:id/verify-pin`, `/pin-status`). If you add an employee-returning endpoint, route it through `sanitizeEmployee` too, and expose `hasPin` (not `pin`) in `openapi.yaml`.

## Payslip printing (frontend-only, no PDF backend)

Printing is done entirely in the browser via a React portal + `@media print`, not server-rendered:

- A portal div `#payroll-print-root` is created at print time; `index.css` keeps it `display:none` on screen and only reveals it under `@media print` (this prevents the payslip lingering on screen if `afterprint` doesn't fire). `#root` is hidden while printing.
- **Single** payslip renders fixed-position full-page; **bulk** print sets `data-bulk-print="true"` on the portal, which switches to static/stacked flow so each 明細 is one page (`payslip-bulk-print.tsx`, one `100vh` block per employee, `window.print()` after all allowance/deduction queries resolve). Both paths render the same `ClassicContent` from `payslip-print-classic.tsx`.
- **N-up（面付け, several payslips per sheet）is intentionally NOT implemented in-app** — users select the browser print dialog's「1枚あたりのページ数」(pages-per-sheet 4/16). Custom scaling was tried and removed because it always cut content off; do not reintroduce it.
- `payslip-print-classic.tsx` does three display-only transforms. **The 支給欄の行の合計は 総支給額 と一致していなければならない** — 行を足し引きするときは必ず検算すること:
  - 社会保険料 is split into 健康保険料 / 厚生年金保険料 (recomputed from the employee's `standardRemuneration` × 令和8年料率; the DB only stores the combined value, and the split is forced to sum back to it).
  - 業績手当 (BW の解答C) は総支給に含まれるので必ず行として出す。
  - 自動計算項目と同名のカスタム手当は二重表示になるため除外する。ただし**BW 自動計算では金額自体が二重計上されている**（上記「二重計上のワナ」）ため、行を消すと合計が合わなくなる。表示の問題ではなくデータの問題として扱うこと。

## ダークモード

`.dark` クラスを `<html>` に付ける方式。`index.css` の `:root` / `.dark` で CSS 変数（`--background`, `--card`, `--muted-foreground` …）を差し替え、Tailwind の `@theme inline` がそれを参照する。

- 切替は `src/context/theme-context.tsx`（ThemeProvider）。localStorage の `theme` が最優先、無ければ OS の `prefers-color-scheme` に追従する。`index.html` のインラインスクリプトが初回描画前に `.dark` を付けて FOUC を防ぐ。
- **対象は管理アプリ（ログイン後の画面）のみ。** ドライバー/事務所の公開QR画面（`/driver/:id`, `/office/:id`）は対象外。
- 新しい UI を書くときは `bg-white` / `text-slate-900` のような固定色ではなく**トークン**（`bg-card` / `text-foreground` / `text-muted-foreground` / `border-border`）を使う。淡色タイント（`bg-blue-50` 等）を使う場合は `dark:` 変種を必ず添える。

## 本番デプロイ（NAS + Cloudflare Tunnel）— `deploy/`

`deploy/README.md` が手順書、`deploy/overview.md` が設計と決定事項。要点だけ:

- **2ホスト構成。** `mikawa-unso.jp` は QR打刻専用の公開ホスト（Access なし）、`admin.mikawa-unso.jp` が管理画面（Cloudflare Access で保護）。QR画面は未ログインで動く必要があるため、サイト全体に Access を掛けることはできない。
- **公開APIの allowlist が2箇所にある。** `routes/index.ts` の `isPublicDriverFlowRequest()` と `deploy/nginx/default.conf` の正規表現。QR画面が叩くエンドポイントを増減したら**両方**直すこと（nginx を忘れると 403 で無言で壊れる）。
- **SSE はバッファリング禁止。** `deploy/nginx/proxy.conf` の `proxy_buffering off` を外すとリアルタイム更新が止まる。
- **QRのURLは公開ホスト固定。** `VITE_PUBLIC_ORIGIN`（ビルド時）。これが無いと管理画面で発行したQRが `admin.*` を指し、ドライバーが Access に弾かれる。
- **本番のみ secure Cookie + `trust proxy`**（`NODE_ENV=production` で有効）。nginx が `X-Forwarded-Proto: https` を付ける前提。

## Local dev on Windows (non-obvious)

The repo was originally built on Replit (linux-x64); the platform-binary-stripping `overrides` that made a Windows checkout impossible have been **removed**, so `pnpm install` now produces working esbuild/Vite/lightningcss binaries on Windows. What still bites:

1. **`pnpm install` must run from Git Bash.** The root `preinstall` script uses `sh -c …`, which doesn't exist in PowerShell/cmd. Run `pnpm install` from Git Bash (or any shell with `sh` on PATH).
2. **`drizzle-kit push` can't resolve a backslash schema path.** `lib/db/drizzle.config.ts` builds `schema` with `path.join(__dirname, …)`, which on Windows yields backslashes and drizzle-kit reports「No schema files found」. Workaround: temporarily change it to the relative literal `schema: "./src/schema/index.ts"`, run the push, then **revert** (don't commit the change — the joined path is what the Linux build wants).
3. **Env vars + shells.** Because there's no dotenv, `scripts/dev.ps1` (PowerShell) is the supported path. If you pass env inline from **Git Bash** instead, `BASE_PATH=/` gets mangled into a Windows path (`/Program Files/Git/`) — set it from PowerShell (`$env:BASE_PATH="/"`) or use `MSYS_NO_PATHCONV=1`. The api-server `dev` script uses `export …` (sh syntax); on Windows run `build` then `start` separately instead of `dev`.
</content>
