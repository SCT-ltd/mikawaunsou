# 給与明細一覧ページ フルモデルチェンジ設計書

日付: 2026-07-02
対象: `artifacts/payroll-app/src/pages/payroll/list.tsx`（535行）
承認: ユーザー承認済み（マスターディテール統一・洗練系・タイポ向上）

## 目的
テーブル＋右スライドインSheet を、他ページと統一した全幅マスターディテール型に刷新。集計サマリーを新設。**API・計算/確定/CSV/印刷ロジック・AllowanceInputPanel・未保存ガードは変更しない**。

## レイアウト（`AppLayout fullWidth`）
- ツールバー: タイトル「給与明細」＋RichMonthPicker＋一括計算＋CSV出力＋一括印刷
- 集計サマリー: 対象人数（＋確定件数）/ 総支給合計 / 控除合計 / 差引支給合計（フラットタイル）
- 計算エラー通知パネル（維持・現行の月次実績リンク付き）
- 2ペイン: 左＝給与リスト（検索・氏名・社員コード・差引・確定/未確定）、右＝詳細
- モバイル: リスト↔詳細を全画面切替

### 詳細ペイン
- ヘッダー: 氏名・社員コード・ステータス＋アクション（この社員のみ再計算／手入力固定で計算／印刷／明細を確定）
- 本体: 既存 `AllowanceInputPanel`（employee, monthlyData, onDirtyChange, year, month）をそのまま使用

## ファイル構成
| ファイル | 内容 |
|---|---|
| `pages/payroll/list.tsx` | 状態・計算/確定/CSV/印刷ハンドラ・レイアウト・ダイアログ/ポータル |
| `components/payroll/summary-stats.tsx` | 集計タイル |
| `components/payroll/payroll-list-pane.tsx` | 左リスト＋filterPayrolls |

## 未保存ガード（維持）
`isDirty`（AllowanceInputPanel の onDirtyChange）→ 詳細切替・クローズ時に requestAction で確認ダイアログ、beforeunload 警告。マスターディテールでは「別の給与を選択」＝trySelectPayroll がガード対象。

## 機能維持
一括計算（エラー収集・未入力案内リンク）、この社員のみ再計算、手入力固定で計算、明細確定、CSV出力、単票印刷ポータル（PayslipPrintClassic）、一括印刷ポータル（PayslipBulkPrint）、印刷 afterprint クリーンアップ。

## タイポグラフィ
氏名・見出しに jp-tight、金額に amount（等幅数字）。

## 変更しないもの
API・全計算/確定/CSV/印刷ロジック・AllowanceInputPanel・未保存ガード判定・印刷ポータルの DOM 構造
