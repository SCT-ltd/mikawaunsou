# lib/api-client-react — 生成された React Query フック（`@workspace/api-client-react`）

`lib/api-spec/openapi.yaml` から Orval が生成する、フロント（payroll-app）用の TanStack Query フック集。**`src/generated/` は手編集禁止**（codegen で上書きされる）。

## 主要ファイル

- `src/generated/` — 生成物（フック定義）。編集しない
- `src/custom-fetch.ts` — Orval の mutator（fetch ラッパ、baseUrl `/api`）。手書きの数少ない実体
- `src/index.ts` — 集約 export

## 依存

- @tanstack/react-query

## 再生成

- `pnpm --filter @workspace/api-spec run codegen`（api-spec の overview.md 参照）

## 現在のステータス

- 生成物のため、内容は `openapi.yaml` に追従

## 決定事項

- 2026-07-02 このファイル作成（api-client-react 階層の overview 初版）
