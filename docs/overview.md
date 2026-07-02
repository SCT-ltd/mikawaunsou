# 三川運送 給与計算・バックオフィス自動化システム — 運送業向けに給与計算〜会計CSV出力までを一気通貫で行うクラウドシステム

## 概要

- 運送業（三川運送）向けの給与計算・バックオフィス効率化システム。
- 基本給・残業・深夜・歩合給の計算から、源泉所得税の自動ルックアップ、社会保険料計算、振替伝票・会計CSV出力までを一気通貫で処理する。
- ドライバーは QR コードから打刻・勤怠確認ができ、事務所とのメッセージ／プッシュ通知、リアルタイム位置マップにも対応する。
- 税額・保険料は「1円単位の完全一致」を目標に、令和8年の公式テーブル（国税庁・協会けんぽ）に基づいて算出する。

## 技術スタック

事実ベース（`package.json` / `pnpm-workspace.yaml` / 各アプリの依存関係から確認）。

- **モノレポ**: pnpm workspaces（`artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`）
- **言語/ ランタイム**: TypeScript 5.9 / Node.js 24、`zod`（catalog は `zod@^3.25.76`。※CLAUDE.md では `zod/v4` 記載 — 下記「不明点」参照）
- **バックエンド（`artifacts/api-server`, `@workspace/api-server`）**
  - Express 5、`/api` にマウント、ポート 8080
  - `express-session` + `connect-pg-simple`（セッションを Postgres に保存）
  - `pino` / `pino-http`（ロギング）
  - `web-push`（Web Push 通知）、`cors`、`cookie-parser`
  - esbuild で単一 ESM ファイルにバンドル（`build.mjs`、`tsc` ではない）
- **フロントエンド（`artifacts/payroll-app`, `@workspace/payroll-app`）**
  - React 19 + Vite 7（SPA、開発サーバは `/api` → `http://localhost:8080` をプロキシ）
  - ルーター: wouter
  - データ取得: TanStack Query（React Query）
  - UI: Tailwind CSS v4 + Radix UI + `class-variance-authority` / `tailwind-merge` / `lucide-react`
  - フォーム: react-hook-form + `@hookform/resolvers`
  - グラフ: recharts、地図: leaflet / react-leaflet、QR: react-qr-code
  - アニメーション: framer-motion
- **データベース**: PostgreSQL + Drizzle ORM（`drizzle-orm@^0.45.1`）。スキーマ変更は `drizzle-kit push`（マイグレーションファイルは持たない）
- **バリデーション / API 契約**: Zod + OpenAPI（`lib/api-spec/openapi.yaml`）を Orval でコード生成
- **デプロイ環境**: Replit（linux-x64）。Windows ネイティブ開発には caveat あり（CLAUDE.md 参照）

## ディレクトリ構成

主要フォルダの役割（実在確認済み）。

- `artifacts/` — デプロイ単位のアプリ（各々を独立してビルド・実行）
  - `artifacts/api-server/` — Express 5 API サーバ
    - `src/routes/` — API ルート（`auth`, `employees`, `payroll`, `monthly_records`, `attendance`, `allowances`, `absences`, `calendar`, `company`, `dashboard`, `journal_entries`, `messages`, `users`, `health`, `index`）
    - `src/lib/` — `payroll-calculator.ts`（給与エンジン）, `tax-tables-reiwa8.ts`（令和8年テーブル）, `auth-middleware.ts`, `params.ts`, `logger.ts`
    - `src/middlewares/`, `src/app.ts`, `src/index.ts`, `build.mjs`
  - `artifacts/payroll-app/` — React + Vite SPA
    - `src/pages/` — 画面（`dashboard`, `payroll/`（`list`/`detail`）, `monthly-input`, `attendance`, `allowances`, `calendar`, `journal`, `messages`, `users`, `settings`, `login`, `driver`, `office`, `realtime-map`, `not-found`）
    - `src/components/`, `src/context/`（`auth-context`）, `src/hooks/`, `src/lib/`, `App.tsx`, `main.tsx`
- `lib/` — `workspace:*` で共有される内部パッケージ（TS project references）
  - `lib/db/` (`@workspace/db`) — Drizzle スキーマ + pg `Pool`/`db` シングルトン。`schema/` に `company`, `employees`, `monthly_records`, `payrolls`, `journal_entries`, `allowances`, `attendance`, `calendar`, `messages`, `sessions`, `users`。**import 時に `DATABASE_URL` 必須**
  - `lib/api-spec/` — `openapi.yaml`（API 契約）+ Orval codegen 設定
  - `lib/api-client-react/` — 生成物（React Query フック）。`src/generated/` は手編集禁止
  - `lib/api-zod/` — 生成物（Zod スキーマ）。同上
  - `lib/tax-tables-reiwa8/` (`@workspace/tax-tables-reiwa8`) — 令和8年 源泉所得税テーブル。**バック・フロント両方で共有**
  - `lib/integrations/` — ワークスペースに登録済みだが現状は空（※中身なし）
- `scripts/` — ワークスペーススクリプト（`post-merge.sh` など）
- `docs/` — ドキュメント（`payroll-calculation-logic.md`, `操作マニュアル.md`, および本ファイル）
- ルート — `replit.md`（ドメイン仕様の正典）, `CLAUDE.md`（横断的な配線・ローカル開発の注意）, `SYSTEM_GUIDE.md`

**依存の向き**: `payroll-app` → `api-client-react` + `tax-tables-reiwa8`、`api-server` → `db` + `api-zod` + `tax-tables-reiwa8`。フロントとバックは互いを import せず、OpenAPI 契約でのみ接続する。

## 現在のステータス

コード・スキーマから読み取れる「実装済み」機能。

### 実装済み（コードが存在）

- **給与計算エンジン** — 基本給 / 時間外 / 深夜 / 歩合、時給制・日給制個人単価オーバーライド、残業単位計算（`payroll-calculator.ts`）
- **源泉所得税ルックアップ** — 令和8年 国税庁月額表甲欄（公式テーブル参照方式、`tax-tables-reiwa8`）
- **社会保険料計算** — 令和8年 協会けんぽ東京支部 標準報酬月額等級テーブル方式（健保・厚年）
- **月次実績入力**（`monthly-input` / `monthly_records`）
- **カスタム手当**（`allowance_definitions` / `employee_allowances`、`fixed`/`variable`/`unit_time` の3計算タイプ）
- **振替伝票の自動生成**（`journal_entries` / `journal` 画面）
- **会計CSV出力** — 弥生会計 / freee / マネーフォワード / generic（replit.md 記載）
- **勤怠打刻**（`attendance`、QR 経由の公開フロー `/driver/:id`・`/office/:id`）
- **PIN 検証フロー**（`POST /employees/:id/pin/verify`）
- **メッセージ機能**（事務所⇔社員、既読管理、SSE ストリーム）
- **Web Push 通知**（`push_subscriptions`、VAPID）
- **リアルタイム位置マップ**（`realtime-map`、leaflet、位置ライブ送信）
- **セッション認証**（Postgres 保存、初回セットアップ時の認証バイパス、prefix ベースの `requireAdmin`）
- **ユーザー管理**（`/users`、パスワードリセット）
- **ダッシュボード / カレンダー / 会社マスタ設定 / 欠勤（absences）**
- **モバイルレスポンシブ対応**（ハンバーガーメニュー、ボトムナビ、カード/テーブル切替 等）

### 未実装・弱点（コード・仕様コメントから）

- **公開エンドポイントの本人性担保** — 未ログインの公開フローは body/URL の `employeeId` をそのまま採用するため、ID 推測で他人の打刻・メッセージ操作が可能（replit.md に「元仕様」「将来のフェーズで強化予定」と明記）
- **テストスイートなし** — vitest/jest/node:test いずれも無し。検証は `pnpm run typecheck` が唯一のゲート（CLAUDE.md 記載）
- `lib/integrations/` は枠だけで中身が無い（※将来の統合用と推測）
- `employees.dailyRateOverride` は廃止（カラムは互換のため残置、コード未参照）

## 主要な設計判断

コードおよびドキュメントから読み取れる範囲。

- **API 契約は生成物**: `openapi.yaml` を単一の真実の源とし、Orval で React Query フックと Zod スキーマを再生成（`clean: true` で毎回上書き）。生成先の手編集は破棄される。
- **税額・保険料の値は公式値をハードコード**: 「1円単位の完全一致」を目的に、令和8年の国税庁／協会けんぽの公式テーブル値をハードコード＋数式補完。旧来の calibration 補正方式は廃止し令和8年版のみ。出典なしの変更は禁止（replit.md / CLAUDE.md）。
- **税テーブルをバック・フロントで共有**: `lib/tax-tables-reiwa8` を両者が import し、バックの計算とフロントのプレビューで同一ロジックを保証。
- **端数処理ルールの固定**: 50銭以下切り捨て、50銭超え切り上げ。
- **フロント/バックの分離**: 相互 import を禁止し、OpenAPI 契約でのみ接続。
- **セッションは Postgres 永続化**: `connect-pg-simple` で API 再起動してもログアウトされない。cookie maxAge 8時間。
- **初回セットアップバイパス**: `system_users` が空の間は全ルート認証なしで通過。1件でも作られると管理ルートは 401/403。
- **公開 QR フロー**: `/driver/:id`・`/office/:id` は固定 allowlist の無認証エンドポイントのみ許可（`isPublicDriverFlowRequest()`）。`requireOwnerOrAdmin` 系は「未ログインは通過、ログイン中ドライバーは本人のみ」という挙動でなりすましを防止。
- **DB はマイグレーションレス運用**: `drizzle-kit push` でスキーマ適用、`lib/db/src/schema/` が真実の源（マイグレーションファイルは非コミット）。
- **API サーバは esbuild バンドル**: `tsc` ではなく `build.mjs` で単一 ESM 化。
- **サプライチェーン対策**: pnpm の `minimumReleaseAge: 1440`（公開後1日未満のパッケージをインストール禁止）。
- **Replit 前提のプラットフォーム最適化**: linux-x64 以外のネイティブバイナリを `overrides` で除外（Windows ネイティブ開発時は該当行を一時的に戻す必要あり）。

## 不明点・要確認

- **Zod のバージョン差異**: catalog は `zod@^3.25.76` だが、CLAUDE.md / replit.md は `zod/v4` と記載。実際に import しているのが v4 互換 API（`zod/v4` サブパス）なのか、実体は v3 系なのか要確認。
- **`lib/integrations/` の用途**: ワークスペースに登録されているが空。想定している外部連携（会計 SaaS 連携等か）は未確認。※推測。
- **`SYSTEM_GUIDE.md` の位置づけ**: 大きめのドキュメントだが本ファイル作成時点で内容未読。`replit.md` との役割分担は要確認。
- **会計 CSV / `stripe-replit-sync`**: workspace の `minimumReleaseAgeExclude` に `stripe-replit-sync` があり、決済連携の存在が示唆されるが、対応コードは今回未確認。※推測。
