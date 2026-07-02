# 月次実績入力ページ フルモデルチェンジ設計書

日付: 2026-07-02
対象: `artifacts/payroll-app/src/pages/monthly-input.tsx`（現行 1,744 行の単一ファイル）
承認: ユーザー承認済み（マスターディテール型・詳細パネルにタブ統合・一括保存＋変更マーク）

## 目的

12列の高密度スプレッドシート型テーブルを廃止し、人が使いやすく洗練されたマスターディテール型レイアウトに刷新する。**計算ロジック・API・データフローは一切変更しない**（給与計算は1円単位の正確性が要件）。

## レイアウト

### 全体
- スティッキーヘッダー: タイトル、`RichMonthPicker`、「勤怠から一括反映」、「N名分を保存」（変更社員数を表示、0なら「実績を保存」無効）
- 2ペイン構成（デスクトップ md+）: 左＝社員リスト（固定幅 ~300px）、右＝選択中社員の詳細パネル
- モバイル（<md）: リスト全画面 → 社員タップで詳細全画面（←戻るボタン）。現行のモバイルカードリストは廃止し統一

### 左ペイン: 社員リスト（employee-list.tsx）
- 検索ボックス（氏名・所属の部分一致）
- 各行: 氏名 / 所属 / 給与形態バッジ（日給・時給・月給、BW）/ 手取り概算 / 状態
  - 状態: `✏️ 変更あり`（未保存・アンバー）→ `✓ 入力済`（データあり）→ `未入力`（グレー）
- 下部: 進捗「入力済 N/M名」
- キーボード: Ctrl(⌘)+↑↓ で社員切り替え（入力中でも有効）
- 選択行ハイライト

### 右ペイン: 詳細パネル
ヘッダー: 氏名・所属・バッジ、勤怠カレンダーボタン（`AttendanceCalendarDialog`）、前へ/次へボタン。

タブ2枚（`components/ui/tabs.tsx` を使用）:

1. **実績入力タブ（record-form.tsx）**
   - 大きな入力欄（h-10 / text-base）、ラベル下に説明文（ツールチップ廃止）
   - セクション: 勤怠・時間（平日/土曜/日祝/欠勤/残業/深夜）→ 実働時間（時給制のみ）→ 運行実績（走行KM）→ BW売上＋A/B/C計算プレビュー（BW社員のみ）→ 備考
   - 給与形態に応じて関係ある項目のみ表示。単位残業設定者（overtimeUnitMinutes/Rate > 0）は「回」入力
   - 下部に概算サマリーカード（総支給・手取りを大きく表示）
2. **手当・控除タブ（allowance-panel.tsx）**
   - 現行 `AllowanceSidebar`（Sheet）の内容を移植: 基本給、手当行（ドラッグ並べ替え）、社会保険料自動計算（折りたたみ）、差引行、差引支給額
   - 保存はタブ内の専用ボタン（社員マスタへの保存のため月次一括保存とは独立）

## 保存モデル

- 一括保存を維持（現行 `handleSaveAll` の payload・hasData 判定・BW自動計算POSTを含めロジック不変）
- 変更検知を社員単位に変更: `dirtyIds: Set<number>`。グローバルの `isDirty`（ナビゲーションガード）は `dirtyIds.size > 0`
- 勤怠一括取り込みは取り込んだ社員を dirty にマーク（現行と同等の警告挙動）

## ファイル構成

| ファイル | 内容 |
|---|---|
| `pages/monthly-input.tsx` | 状態管理（edits/dirtyIds/選択社員/年月）、保存・取り込み、2ペイン骨格 |
| `components/monthly-input/estimate.ts` | `roundJapanese` / `resolvePensionApplied` / `calculateIncomeTaxFromOfficialTable` / `computeQuickEstimate` / `computeBWCalc`（移動のみ・無変更） |
| `components/monthly-input/employee-list.tsx` | 左ペイン |
| `components/monthly-input/record-form.tsx` | 実績入力タブ＋BWプレビュー |
| `components/monthly-input/allowance-panel.tsx` | 手当・控除タブ（旧 AllowanceSidebar 移植） |

## 変更しないもの

- API 呼び出し・React Query フック・payload 形状
- 給与計算式（estimate.ts への移動のみ）
- 勤怠一括取り込み（`/api/attendance/monthly-summary`）、勤怠カレンダーダイアログ、ナビゲーションガード、beforeunload 警告
- デバッグ用 console.log（挙動パリティ維持のため残置）

## 検証

- `pnpm run typecheck`（既存の list.tsx / settings.tsx の型エラーは対象外）
- ブラウザで /monthly-input を実操作（選択切替・入力・dirty マーク・保存・取り込み・タブ・モバイル幅）
- マルチエージェントレビューで旧実装との挙動パリティを検証
