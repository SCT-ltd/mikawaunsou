# lib/api-zod — 生成された Zod スキーマ（`@workspace/api-zod`）

`lib/api-spec/openapi.yaml` から Orval が生成する、リクエスト/レスポンス検証用の Zod スキーマ集。主に api-server が使用する。**`src/generated/` は手編集禁止**（codegen で上書きされる）。

## 主要ファイル

- `src/generated/` — 生成物（Zod スキーマ）。編集しない
- `src/index.ts` — 集約 export（barrel。過去に TS2308 衝突を解消した経緯あり: コミット ee68e3e）

## 依存

- zod

## 再生成

- `pnpm --filter @workspace/api-spec run codegen`（api-spec の overview.md 参照）

## 現在のステータス

- 生成物のため、内容は `openapi.yaml` に追従

## 決定事項

- 2026-07-02 このファイル作成（api-zod 階層の overview 初版）
