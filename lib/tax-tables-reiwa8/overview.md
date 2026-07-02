# lib/tax-tables-reiwa8 — 令和8年 源泉所得税テーブル（共有）（`@workspace/tax-tables-reiwa8`）

令和8年分の源泉所得税・社会保険料等級テーブル。**バックエンド（給与計算）とフロントエンド（プレビュー計算）の両方が import** し、同一ロジックを保証する共有パッケージ。

> 税額・保険料の値は「1円単位の完全一致」を目的に公式値をハードコードしている。**変更は必ず `replit.md` に記載の国税庁 / 協会けんぽの出典に基づくこと。** 詳細な料率・上限・端数処理は `replit.md` が正典。

## 主要ファイル

- `src/index.ts` — テーブル定義と参照ロジック（公式値ハードコード + 数式補完）

## 利用側

- api-server: `artifacts/api-server/src/lib/tax-tables-reiwa8.ts`（本パッケージのラッパ）
- payroll-app: プレビュー計算で直接 import

## 要点（詳細は replit.md）

- 源泉所得税: 令和8年 国税庁 月額表 甲欄（公式テーブル参照方式）。扶養親族等の数 = dependentCount + (hasSpouse ? 1 : 0)
- 社会保険料: 令和8年 協会けんぽ東京支部 標準報酬月額等級テーブル（健保 9.85% / 厚年 18.300%）
- 端数処理: 50銭以下切り捨て、50銭超え切り上げ

## コマンド

- 型チェック: `pnpm --filter @workspace/tax-tables-reiwa8 run typecheck`

## 現在のステータス

- 実装済み: 令和8年版（calibration 補正方式は廃止）

## 決定事項

- 2026-07-02 このファイル作成（tax-tables-reiwa8 階層の overview 初版）
