# lib/api-spec — API 契約（OpenAPI）と Orval コード生成の起点（`@workspace/api-spec`）

`openapi.yaml` が API の**単一の真実の源**。ここから Orval が2つのパッケージ（`api-client-react` の React Query フックと `api-zod` の Zod スキーマ）を再生成する。エンドポイントの形を変えるときは、生成物ではなく **このファイルを編集**して codegen を回す。

## 主要ファイル

- `openapi.yaml` — API コントラクト（エンドポイント・スキーマ定義）
- `orval.config.ts` — Orval 設定（`clean: true` で生成先を毎回上書き）

## 生成フロー

1. `openapi.yaml` を編集
2. `pnpm --filter @workspace/api-spec run codegen`
3. 生成先が再生成される:
   - `lib/api-client-react/src/generated/`（フック、mutator は `custom-fetch.ts`、baseUrl `/api`）
   - `lib/api-zod/src/generated/`（Zod スキーマ）

**注意**: 生成先の `src/generated/` を手で編集しても codegen で消える。

## スタック・依存

- orval（devDep）

## 現在のステータス

- 実装済み: 契約定義 + codegen 設定

## 決定事項

- 2026-07-02 このファイル作成（api-spec 階層の overview 初版）
- 2026-07-02 生成型ドリフトの是正（型基盤の整理）。DB・実装にはあるが `openapi.yaml` に未定義だったフィールドを追加し codegen 再実行:
  - `salaryType` enum に `hourly`（時給制事務員）を追加（`Employee` / `UpdateEmployeeBody`。`CreateEmployeeBody` は既存）。
  - `Company` / `UpdateCompanyBody` に `dailyWageWeekday` / `dailyWageSaturday` / `hourlyWageSunday` を追加。
  - `Payroll` に `customAllowancesTotal` / `childcareSupportContribution` を追加。
  これにより payroll-app の型エラーが 18→5 に減少（残5件は date-parts-input / dashboard / driver / office の別種の既存不具合で型ドリフトではない）。付随して `payroll/detail.tsx` の不要な `@ts-expect-error` を除去し、DBに存在しない `payroll.sundayWorkDays` 参照を実在する `holidayWorkDays` に修正。
  - ※ Windows で codegen すると生成物が CRLF 化しコミット時に多数のファイルが差分表示されるが、内容差分は上記のみ（行末は正規化される想定）。
