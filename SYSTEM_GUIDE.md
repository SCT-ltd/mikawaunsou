# 三川運送 給与・バックオフィス管理システム — システムガイド

> 最終更新：2026年4月  
> バージョン：1.0

---

## 目次

1. [システム概要](#1-システム概要)
2. [画面一覧と操作方法](#2-画面一覧と操作方法)
3. [給与計算のしくみ](#3-給与計算のしくみ)
4. [勤怠管理・打刻機能](#4-勤怠管理打刻機能)
5. [データベース構造](#5-データベース構造)
6. [API エンドポイント一覧](#6-api-エンドポイント一覧)
7. [開発・運用情報](#7-開発運用情報)

---

## 1. システム概要

三川運送向けに開発された**給与計算・バックオフィス自動化クラウドシステム**です。

### 主な機能

| 機能 | 内容 |
|------|------|
| 給与明細作成 | 基本給・残業・深夜・歩合・各種手当の自動計算 |
| 社会保険料計算 | 健保・厚年・雇保の料率ベース自動計算 |
| 源泉所得税 | 国税庁月額表（甲欄）に準拠した自動計算 |
| 振替伝票 | 給与支払に伴う仕訳の自動生成 |
| CSV出力 | 弥生会計・freee・マネーフォワード・汎用形式 |
| 勤怠打刻 | QRコード＋PIN認証によるドライバー向け打刻 |
| リアルタイム勤怠 | 事務所ダッシュボードでのSSEリアルタイム更新 |
| 日給制対応 | 平日/土曜/日曜ごとの単価による基本給自動計算 |

### システム構成

```
ブラウザ（事務所・ドライバー）
    │
    ├── 給与管理アプリ（React + Vite）
    │       パス: /
    │
    └── API サーバー（Express 5）
            パス: /api
            └── PostgreSQL データベース
```

---

## 2. 画面一覧と操作方法

### 2-1. ダッシュボード `/`

今月の給与支払状況のサマリーを表示します。

- 社員数・当月確定件数・支払総額
- 月別の支払額グラフ
- 最近の給与明細一覧

---

### 2-2. 社員管理 `/employees`

#### 社員一覧

在籍中の社員を一覧表示します。社員番号・氏名・部署・基本給・ステータスを確認できます。

#### 社員新規登録 `/employees/new`

以下の項目を入力します：

| 項目 | 説明 |
|------|------|
| 社員番号 | 任意の識別コード（例：EMP001）|
| 氏名 / フリガナ | フルネーム |
| 部署 / 役職 | 所属・役職 |
| 給与形態 | **固定給** または **日給制** |
| 基本給 | 固定給の場合の月額基本給（円）|
| 歩合単価（km / 件） | 走行距離・配送件数に対する歩合 |
| 扶養親族数 | 源泉所得税計算に使用 |
| 住民税 | 月額住民税（円）|
| 入社日 | |
| 在籍状況 | 退職時にオフ |

#### 社員編集 `/employees/:id`

登録済み情報の変更に加え、以下も管理できます：

- **給与形態**（固定給 ↔ 日給制）の変更
- **打刻PINコード**の設定・変更・リセット

---

### 2-3. 月次実績入力 `/monthly-input`

月ごとの勤務実績を全社員分まとめて入力します。

#### 入力項目

| 列 | 内容 | 単位 |
|----|------|------|
| 平日出勤 | 平日の出勤日数 | 日（0.5刻み）|
| 土曜出勤 | 土曜日の出勤日数 | 日（0.5刻み）|
| 日曜(h) | 日曜日の勤務時間 | 時間（0.5刻み）|
| 欠勤日数 | 欠勤した日数 | 日 |
| 残業(h) | 時間外労働時間 | 時間 |
| 深夜(h) | 深夜労働時間（22時〜翌5時）| 時間 |
| 休日出勤 | 法定休日の出勤日数 | 日 |
| 走行距離(km) | 当月総走行距離 | km |
| 配送件数 | 当月総配送件数 | 件 |
| 備考 | 摘要・特記事項 | テキスト |

#### 手当入力サイドパネル

社員名をクリックすると右側に手当入力パネルが開きます。

- **基本給**
  - 固定給社員：手入力
  - **日給制社員：自動計算（読み取り専用・青字表示）**
    - 計算式：平日日数 × 平日日給 ＋ 土曜日数 × 土曜日給 ＋ 日曜時間 × 日曜時給
- **手当**：カスタム手当マスターから選択・金額入力
- **差引**：積立・その他差引を入力

パネル内では給与明細プレビュー（総支給・控除計・差引支給額）をリアルタイムで確認できます。

> 入力後は必ず「一括保存」ボタンを押してください。

---

### 2-4. 給与明細 `/payroll`

#### 給与計算の実行

年・月を選択して「計算実行」ボタンを押すと、全社員分の給与明細が生成されます。

#### 明細の確認・修正

各社員の明細を開き、内容を確認します。必要に応じて個別修正が可能です。

#### 確定・CSV出力

- 「確定」ボタンで当月給与を確定します（確定後は編集不可）
- CSV出力形式：弥生会計 / freee / マネーフォワード / 汎用

---

### 2-5. 振替伝票 `/journal`

給与確定後に仕訳データを自動生成・確認できます。

- 出力形式：弥生会計 / freee / マネーフォワード / 汎用

---

### 2-6. 勤怠管理 `/attendance`

ドライバーの出勤・退勤・休憩の打刻状況をリアルタイムで確認します。

#### 日付ナビゲーション

- **← →** ボタンで前日・翌日に移動
- **カレンダー** アイコンで任意の日付に移動
- **今日** ボタンで今日に戻る

**今日の表示**：SSE（サーバー送信イベント）により自動更新（リアルタイム）  
**過去日の表示**：REST APIで静的取得

#### 表示内容（各社員）

| 項目 | 内容 |
|------|------|
| 出勤時刻 | 最初の clock_in 時刻 |
| 退勤時刻 | 最後の clock_out 時刻 |
| 勤務時間 | 出勤〜退勤の実働時間 |
| 休憩合計 | 休憩時間の合計 |
| ステータス | 出勤中 / 退勤済 / 休憩中 / 未出勤 |

---

### 2-7. ドライバー打刻画面 `/driver`

ドライバー専用のQRコード打刻ページです。事務所のタブレット等に常時表示します。

#### 打刻フロー

```
QRコードを読み取る
    ↓
PIN設定あり → 4桁テンキー入力 → 照合OK → 打刻画面
PIN設定なし → 直接打刻画面
    ↓
「出勤」「退勤」「休憩開始」「休憩終了」ボタンを押す
    ↓
打刻完了（一定時間後に初期画面に戻る）
```

---

### 2-8. 会社設定 `/settings`

#### 基本設定

| 項目 | 内容 | デフォルト |
|------|------|-----------|
| 会社名 | 表示用会社名 | — |
| 給与締め日 | 1〜31（31は月末） | 31 |
| 給与支払日 | 1〜31（31は月末） | 25 |

#### 日給レート設定

日給制社員に適用される基本単価です。

| 項目 | デフォルト |
|------|-----------|
| 平日 日給（円/日）| 9,808円 |
| 土曜 日給（円/日）| 12,260円 |
| 日曜 時給（円/時）| 1,655円 |

---

### 2-9. マスター管理 `/master`

#### 計算テーブルマスター

保険料率・割増率を管理します。

| 設定項目 | デフォルト |
|----------|-----------|
| 健康保険料率（本人）| 5.00% |
| 健康保険料率（会社）| 5.00% |
| 厚生年金料率（本人）| 9.15% |
| 厚生年金料率（会社）| 9.15% |
| 雇用保険料率（本人）| 0.60% |
| 雇用保険料率（会社）| 0.85% |
| 月平均所定労働時間 | 160時間 |
| 時間外割増率 | 1.25 |
| 深夜割増率（追加分）| 0.25 |
| 休日出勤割増率 | 1.35 |

#### カスタム手当マスター

手当の種類を自由に定義できます。

| 項目 | 説明 |
|------|------|
| 名称 | 手当の表示名 |
| 課税区分 | 課税 / 非課税 |
| 計算タイプ | 固定額 / 変動入力 / 単価×時間 |
| 表示順 | 明細書上の表示順序 |
| 有効 / 無効 | 無効にすると入力欄から非表示 |

---

## 3. 給与計算のしくみ

### 3-1. 基本給

**固定給社員**：社員マスターの基本給をそのまま使用

**日給制社員**：月次実績から自動計算

```
基本給 = 平日出勤日数 × 平日日給
       ＋ 土曜出勤日数 × 土曜日給
       ＋ 日曜勤務時間 × 日曜時給
```

### 3-2. 各種手当

```
残業手当    = (基本給 ÷ 月平均労働時間) × 残業割増率 × 残業時間
深夜手当    = (基本給 ÷ 月平均労働時間) × 深夜割増率 × 深夜時間
休日手当    = (基本給 ÷ 月平均労働時間) × 休日割増率 × 休日出勤時間
歩合給（距離）= 走行距離(km) × km単価
歩合給（件数）= 配送件数 × 件単価
カスタム手当 = 各手当マスターに従って計算・加算
```

### 3-3. 総支給額

```
総支給額 = 基本給 + 残業手当 + 深夜手当 + 休日手当 + 歩合給 + カスタム手当合計
```

### 3-4. 社会保険料控除

```
健康保険料 = 総支給額 × 健保料率（本人）
厚生年金   = 総支給額 × 厚年料率（本人）
雇用保険   = 総支給額 × 雇保料率（本人）  ※雇保対象者のみ
保険料合計 = 健康保険料 ＋ 厚生年金 ＋ 雇用保険
```

> 端数処理：50銭以下→切り捨て、50銭超→切り上げ（日本の慣行に準拠）

### 3-5. 源泉所得税

国税庁「給与所得の源泉徴収税額表（月額表）甲欄」に基づく計算

```
課税対象額 = 総支給額 - 保険料合計
源泉所得税 = 税額表の税率 × 課税対象額 - 定額控除 - 扶養控除 × 3,750円
           （復興特別所得税 2.1% を加算後に端数処理）
```

### 3-6. 差引支給額

```
差引支給額 = 総支給額 - 保険料合計 - 源泉所得税 - 住民税 - その他差引合計
```

---

## 4. 勤怠管理・打刻機能

### 4-1. 打刻の種類

| イベント | 説明 |
|----------|------|
| `clock_in` | 出勤 |
| `clock_out` | 退勤 |
| `break_start` | 休憩開始 |
| `break_end` | 休憩終了 |

### 4-2. PINコード認証

各社員にQRコード打刻用の4桁PINを設定できます。

- **設定あり**：QRコード読み取り後、4桁PIN入力が必要
- **設定なし**：QRコード読み取りのみで打刻可能
- PINの設定・変更・リセットは社員編集画面から行います

### 4-3. リアルタイム更新（SSE）

事務所の勤怠ダッシュボードは、今日の打刻に限りSSE（Server-Sent Events）でリアルタイム自動更新されます。過去日は REST API による静的表示となります。

---

## 5. データベース構造

### テーブル一覧

#### `company`（会社マスタ）

| カラム | 型 | 説明 |
|--------|----|------|
| id | serial | 主キー |
| name | text | 会社名 |
| closing_day | integer | 給与締め日 |
| payment_day | integer | 給与支払日 |
| monthly_average_work_hours | double | 月平均所定労働時間 |
| health_insurance_employee_rate | double | 健保料率（本人） |
| health_insurance_employer_rate | double | 健保料率（会社） |
| pension_employee_rate | double | 厚年料率（本人） |
| pension_employer_rate | double | 厚年料率（会社） |
| employment_insurance_rate | double | 雇保料率（本人） |
| employment_insurance_employer_rate | double | 雇保料率（会社） |
| overtime_rate | double | 時間外割増率 |
| late_night_additional_rate | double | 深夜割増率（追加分） |
| holiday_rate | double | 休日割増率 |
| **daily_wage_weekday** | double | **平日日給（円）** |
| **daily_wage_saturday** | double | **土曜日給（円）** |
| **hourly_wage_sunday** | double | **日曜時給（円）** |

#### `employees`（社員マスタ）

| カラム | 型 | 説明 |
|--------|----|------|
| id | serial | 主キー |
| employee_code | text | 社員番号 |
| name | text | 氏名 |
| name_kana | text | フリガナ |
| department | text | 部署 |
| position | text | 役職 |
| base_salary | double | 基本給（固定給の場合） |
| commission_rate_per_km | double | 歩合単価（km） |
| commission_rate_per_case | double | 歩合単価（件） |
| dependent_count | integer | 扶養親族数 |
| health_insurance_monthly | double | 健保月額固定額 |
| pension_monthly | double | 厚年月額固定額 |
| employment_insurance_applied | boolean | 雇保適用有無 |
| resident_tax | double | 住民税月額 |
| hire_date | date | 入社日 |
| is_active | boolean | 在籍フラグ |
| **salary_type** | text | **給与形態（fixed / daily）** |
| pin | text | 打刻PINコード（ハッシュ化） |

#### `monthly_records`（月次実績）

| カラム | 型 | 説明 |
|--------|----|------|
| id | serial | 主キー |
| employee_id | integer | 社員ID |
| year | integer | 年 |
| month | integer | 月 |
| work_days | double | 平日出勤日数 |
| **saturday_work_days** | double | **土曜出勤日数** |
| **sunday_work_hours** | double | **日曜勤務時間** |
| overtime_hours | double | 残業時間 |
| late_night_hours | double | 深夜労働時間 |
| holiday_work_days | double | 休日出勤日数 |
| absence_days | double | 欠勤日数 |
| driving_distance_km | double | 走行距離（km）|
| delivery_cases | integer | 配送件数 |
| notes | text | 備考 |

#### `payrolls`（給与計算結果）

| カラム | 型 | 説明 |
|--------|----|------|
| id | serial | 主キー |
| employee_id | integer | 社員ID |
| year / month | integer | 対象年月 |
| base_salary | double | 基本給 |
| overtime_pay | double | 残業手当 |
| late_night_pay | double | 深夜手当 |
| holiday_pay | double | 休日手当 |
| commission | double | 歩合給 |
| custom_allowances_total | double | カスタム手当合計 |
| gross_salary | double | 総支給額 |
| health_insurance | double | 健康保険料 |
| pension | double | 厚生年金 |
| employment_insurance | double | 雇用保険料 |
| income_tax | double | 源泉所得税 |
| resident_tax | double | 住民税 |
| net_salary | double | 差引支給額 |
| status | text | draft / confirmed |

#### `attendance_records`（勤怠打刻記録）

| カラム | 型 | 説明 |
|--------|----|------|
| id | serial | 主キー |
| employee_id | integer | 社員ID |
| event_type | text | clock_in / clock_out / break_start / break_end |
| work_date | date | 勤務日 |
| recorded_at | timestamp | 打刻日時 |

#### `allowance_definitions`（カスタム手当マスタ）

| カラム | 型 | 説明 |
|--------|----|------|
| id | serial | 主キー |
| name | text | 手当名称 |
| is_taxable | boolean | 課税区分 |
| calculation_type | text | fixed / variable / unit_time |
| display_order | integer | 表示順 |
| is_active | boolean | 有効フラグ |

#### `journal_entries`（振替伝票）

給与確定時に自動生成される仕訳データです。

---

## 6. API エンドポイント一覧

### 会社

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/company` | 会社情報取得 |
| PUT | `/api/company` | 会社情報更新 |

### 社員

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/employees` | 社員一覧 |
| POST | `/api/employees` | 社員新規登録 |
| GET | `/api/employees/:id` | 社員詳細 |
| PUT | `/api/employees/:id` | 社員更新 |
| DELETE | `/api/employees/:id` | 社員削除（論理）|
| GET | `/api/employees/:id/pin/status` | PIN設定確認 |
| PUT | `/api/employees/:id/pin` | PIN設定・変更 |
| POST | `/api/employees/:id/pin/verify` | PIN照合 |
| DELETE | `/api/employees/:id/pin` | PINリセット |

### 月次実績

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/monthly-records?year=&month=` | 月次実績一覧 |
| POST | `/api/monthly-records` | 実績登録（upsert）|
| GET | `/api/monthly-records/:id` | 実績詳細 |
| PUT | `/api/monthly-records/:id` | 実績更新 |

### 給与

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/payrolls?year=&month=` | 給与明細一覧 |
| POST | `/api/payrolls/calculate` | 給与計算実行 |
| GET | `/api/payrolls/:id` | 明細詳細 |
| PUT | `/api/payrolls/:id` | 明細更新 |
| POST | `/api/payrolls/:id/confirm` | 明細確定 |
| GET | `/api/payrolls/export/csv?year=&month=&format=` | CSV出力 |

### 勤怠

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/attendance/today?date=YYYY-MM-DD` | 勤怠状況取得 |
| GET | `/api/attendance/stream` | SSEストリーム（今日のみ）|
| POST | `/api/attendance/record` | 打刻記録 |
| PATCH | `/api/attendance/records/:id` | 打刻修正 |
| DELETE | `/api/attendance/records/:id` | 打刻削除 |

### 振替伝票

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/journal-entries?year=&month=` | 伝票一覧 |
| POST | `/api/journal-entries/generate` | 伝票生成 |
| GET | `/api/journal-entries/export/csv?format=` | CSV出力 |

### 手当マスター

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/allowance-definitions` | 手当定義一覧 |
| POST | `/api/allowance-definitions` | 手当定義追加 |
| PUT | `/api/allowance-definitions/:id` | 手当定義更新 |
| GET | `/api/employees/:id/allowances` | 社員手当取得 |
| PUT | `/api/employees/:id/allowances` | 社員手当更新 |

---

## 7. 開発・運用情報

### 技術スタック

| 要素 | 技術 |
|------|------|
| パッケージ管理 | pnpm workspaces（モノレポ）|
| フロントエンド | React + Vite + TypeScript |
| バックエンド | Express 5 + TypeScript |
| データベース | PostgreSQL + Drizzle ORM |
| バリデーション | Zod v4 + drizzle-zod |
| API自動生成 | Orval（OpenAPI → React Query hooks）|

### ディレクトリ構成

```
workspace/
├── artifacts/
│   ├── payroll-app/         # フロントエンド（React + Vite）
│   │   └── src/pages/       # 各画面
│   └── api-server/          # バックエンド（Express）
│       └── src/routes/      # APIルート
├── lib/
│   ├── db/                  # DBスキーマ（Drizzle）
│   │   └── src/schema/
│   ├── api-spec/            # OpenAPI仕様書
│   └── api-client-react/    # 自動生成APIクライアント
└── SYSTEM_GUIDE.md          # このファイル
```

### 主要な開発コマンド

```bash
# スキーマ変更をDBに反映
pnpm --filter @workspace/db run push

# OpenAPI仕様からAPIクライアントを再生成
pnpm --filter @workspace/api-spec run codegen

# 全パッケージの型チェック
pnpm run typecheck

# APIサーバー起動（開発）
pnpm --filter @workspace/api-server run dev

# フロントエンド起動（開発）
pnpm --filter @workspace/payroll-app run dev
```

### 環境変数

| 変数名 | 説明 |
|--------|------|
| `DATABASE_URL` | PostgreSQL接続文字列 |
| `SESSION_SECRET` | セッション署名用シークレット |
| `PORT` | サーバーのリスニングポート |

### 注意事項

- **給与確定後の修正は不可**です。確定前に内容を必ず確認してください。
- **DBスキーマ変更時**は `pnpm --filter @workspace/db run push` を実行してください。主キーの型変更は行わないでください。
- **日給レート変更**は会社設定画面から行ってください。変更は即時反映されます（過去月の計算済みデータには影響しません）。
- **PINコード**は暗号化してDBに保存されます。管理者でも平文を確認することはできません。
