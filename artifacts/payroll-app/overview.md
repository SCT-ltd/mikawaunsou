# artifacts/payroll-app — 三川運送システムのフロントエンド SPA（`@workspace/payroll-app`）

React 19 + Vite 7 のシングルページアプリ。給与計算・勤怠・メッセージ等の管理画面と、QR 経由の公開ドライバー/事務所フローを提供する。開発サーバは `/api` → `http://localhost:8080` をプロキシ。

> ドメイン仕様（画面ごとの計算・モバイル対応の詳細）は プロジェクトルートの `replit.md` が正典。ここでは payroll-app 内部の地図だけを書く。

## 主要ファイル

- `src/main.tsx` / `src/App.tsx` — エントリと `ProtectedRoutes`（wouter ルーティング）
- `src/context/auth-context.tsx` — `AuthProvider` / `useAuth()`
- `src/pages/` — 画面
  - 管理: `dashboard`, `payroll/`（`list`/`detail`）, `monthly-input`, `attendance`, `allowances`, `calendar`, `journal`, `messages`, `users`, `settings`, `login`
  - 公開フロー: `driver`, `office`（`ProtectedRoutes` の外）
  - その他: `realtime-map`（Leaflet 位置マップ）, `not-found`
- `src/components/` — 共有 UI（Radix ベース）
- `src/hooks/`, `src/lib/`, `src/index.css`
- `vite.config.ts` — `PORT` / `BASE_PATH` 必須（未設定で throw）、`/api` プロキシ設定

## スタック・依存

- React 19 / Vite 7 / wouter（router）/ TanStack Query（取得）
- UI: Tailwind CSS v4 + Radix UI + CVA + tailwind-merge + lucide-react
- フォーム: react-hook-form + @hookform/resolvers、グラフ: recharts
- 地図: leaflet / react-leaflet、QR: react-qr-code、アニメ: framer-motion
- ワークスペース依存: `@workspace/api-client-react`（生成フック）, `@workspace/tax-tables-reiwa8`（プレビュー計算）
- バックとは直接 import せず、生成された API クライアント経由

## コマンド

- 型チェック: `pnpm --filter @workspace/payroll-app run typecheck`
- 開発: `pnpm --filter @workspace/payroll-app run dev`（要 env: `PORT` `BASE_PATH`。Windows は PowerShell で `$env:BASE_PATH="/"`）
- ビルド: `pnpm --filter @workspace/payroll-app run build`

## 現在のステータス

- 実装済み: 上記画面群・認証ラッパ・公開QRフロー・リアルタイムマップ・モバイルレスポンシブ
- 未実装/弱点: （要記入）

## 決定事項

- 2026-07-02 このファイル作成（payroll-app 階層の overview 初版）
- 2026-07-02 月次実績入力を「保存して計算」に統一。従来は保存時に **Bluewing 社員だけ** 裏で給与計算していた（結果は給与明細の一括計算で上書きされ二重計算・非一貫）ため削除し、保存した全社員を続けて `POST /payroll/calculate`（`employeeId/year/month` のみ渡しBW判定はサーバに一任）で計算する方式に変更。確定済みはサーバが 409 で弾くため無視。ボタン文言も「保存して計算」に変更。
- 2026-07-02 給与明細一覧（`payroll/list.tsx`）の `useListPayrolls`/`useListEmployees` から `staleTime:0 / refetchOnMount:"always"` を除去（計算・確定後は `invalidateQueries` で明示再取得しており毎マウント強制リフェッチは不要）。副次的に既存の型エラー2件も解消。行ごと計算ボタンの文言を「月次実績から計算」→「この社員のみ再計算」に変更し一括計算との役割を明確化。
- 2026-07-02 マスター管理（`allowances.tsx`）の「計算に反映されない入力」を整理。(A) 計算テーブルマスターの健康保険/介護/厚生年金の各料率・雇用保険会社負担率・残業/深夜/休日割増率は、給与エンジンが令和8年公式値をハードコードしており未使用のため、`disabled` の参考表示に変更（実際に反映されるのは雇用保険本人負担率と月平均労働時間のみ、と明示）。(B) 社員マスターの healthInsuranceMonthly / pensionMonthly / incomeTaxMonthly の「手動上書き」欄はツールチップで「手動優先」と謳うが backend が一切読まないため、schema/デフォルト/reset/UI から完全削除（自動計算に一本化する旨の注記に置換）。(D) `useListEmployees` の `staleTime:0/refetchOnMount:true` を除去（既存の queryKey 型エラーも解消）。(F) 一覧の sortOrder 表示を編集フォームと揃えて `Math.max(1, …)` に統一。理由: 「入力・保存できるのに計算へ反映されない」項目は誤った期待と事故を招くため。
- 2026-07-02 三川ロジック関連UIを削除（デッドコード整理・フェーズ1）。`allowances.tsx` の「三川歩合率（%）」フィールド（schema/デフォルト/reset/submit/UI）、`monthly-input.tsx` の `mikawaCommissionRate` 由来 seeding と保存 payload の `salesAmount`/`commissionRate`、`components/monthly-input/estimate.ts` の `mikawaCommissionRate` 型・データ有無判定の `salesAmount` を除去。月次実績の入力UI（RecordForm）は既に売上/歩合%欄を持たずBW売上のみのため変更なし。新規 typecheck エラーは追加していない（残る `allowances.tsx` 2件は既存の `salaryType:"hourly"` 生成型ドリフト）。
- 2026-07-02 マスターUI簡素化（フェーズ2-②、実態4パターン=BW/固定給/事務員(時給)/日給 に合わせる）。(1) 「歩合単価（円/km・円/件）」は未使用のため社員フォームから削除（schema/デフォルト/reset/UI。歩合設定セクションごと除去）。(2) 表示の出し分けを実装: 個人単価設定（平日/土曜日当・残業時給・高度な残業単位）は日給制のときのみ表示、ブルーウィング設定の各フィールドは「BWロジック使用」トグルON時のみ表示（トグル自体は常時表示）。就労時間（開始/終了・未定）は打刻の遅刻/残業判定に使うため存置。
- 2026-07-02 固定手当のレガシー表示を除去（表示層のみ／ユーザー判断）。固定手当6種は設定UIが無く常に0のため、給与エンジン（1円一致の核）には触れず**表示だけ**を整理:
  - `payslip-print-classic.tsx`: 交通費・無事故・長距離・役職・家族の表示行を BW/標準の両分岐から除去。
  - `payroll/detail.tsx`: 常に¥0で出ていた通勤・無事故・長距離・役職の行を除去。
  - ※ `earlyOvertimeAllowance` は BW では固定残業代（`bluewingFixedOvertimeAmount`）として非0の実値が入るため**存置**。
  - ※ エンジン・DBカラム・openapi はそのまま（値0で無害）。将来カスタム手当へ完全移行する場合の残タスク。
- 2026-07-03 計算テーブルマスターを①②に再構築（「編集できる見た目なのに計算に効かない」問題の根治）。`allowances.tsx` の `CalcTableMasterTab` を全面書き換え:
  - **① 適用中の税・保険基準（令和8年度）**: 健保/介護/厚年/子育て支援金の料率・割増率・源泉（月額表甲欄）を**読み取り専用**で表示。値はフロント共有 `@/lib/tax-tables-reiwa8` に新設した R8 定数（`HEALTH_EMPLOYEE_RATE_R8` 等、バックエンド定数のミラー）を単一の源として参照。手打ちの `TAX_BRACKETS` 抜粋表は撤去。
  - **② 運用パラメータ**: 実際に計算へ効く `monthlyAverageWorkHours` と `employmentInsuranceRate` のみ編集可。日給単価は会社設定(settings)に一本化（重複回避、相互に案内文を掲示）。
  - **プレビュー統一**: `components/monthly-input/estimate.ts` の概算計算を、company の可変料率参照から R8 定数＋標準報酬月額等級表（`calculateInsuranceByGrade`）に変更。これで「プレビュー≠確定給与」の乖離要因を解消。
  - `settings.tsx` の案内文を実態（料率は内蔵・参照専用、編集は月平均労働時間/雇用保険率のみ）に更新。
- 2026-07-03 運用リスクの是正（フロント側）:
  - **確定解除ボタン**: `payroll/list.tsx` の明細パネルに、確定済みのとき「確定を解除」ボタン（`useUnconfirmPayroll`）を追加。
  - **社員削除の導線改善**: 削除ダイアログに「退職は在籍OFFを使う／賃金台帳は法定保存」の警告を追加。バックエンド 409（給与・月次実績あり）を受けて理由をトースト表示。
  - **PIN未設定バッジ**: 社員一覧（PC/モバイル）で、在籍中のドライバー（非事務員）に `hasPin=false` の場合「PIN未設定」バッジを表示（なりすまし打刻の予防を可視化）。
  - **注意書き**: 月次実績「勤怠から一括反映」ボタンに手入力上書きの注意、給与明細「手入力固定」ボタンに勤怠非連動の注意を title で追加。
  - ※ 標準報酬月額（9月）・住民税（6月）の年次更新は既存フィールドの注記で timing を明示済み。リマインド自動化は未実装（運用対応）。同時編集の排他制御・初回セットアップバイパスは仕様上の既知事項として据え置き。
- 2026-07-03 一般ユーザー向けの分かりやすさ改善（UX）:
  - 給与明細画面に「給与の流れ（①月次実績保存→②一括計算→③確定）」の常時表示ガイドと、各計算ボタン（一括計算/再計算/手入力固定/確定）への説明 title を追加（計算ボタン乱立・確定の意味の不明瞭さを緩和）。
  - 手当・控除パネル: 種類が未定義のとき「まずマスター管理で種類を作成」への案内を表示（手当追加の2段階が分かりにくい問題）。
  - ドライバー打刻: 出勤中で帰着メーター未入力のとき「退勤には帰着(km)入力が必要」を常時表示（退勤ボタンが押せない理由の明示）。
  - 計算テーブルマスター①に「参照専用・編集不可」バッジ。保険・扶養タブに社労士用語のミニ解説（標準報酬月額/折半/扶養親族/甲欄/全額非課税）を折りたたみで追加。
  - バックエンドの英語エラー（Employee/Payroll/Monthly record not found 等）を日本語化。`list.tsx` の月次実績未入力の検出を日本語文言にも対応。
- 2026-07-09 給与明細の印刷まわりを修正:
  - 印刷ハンドラ（`payroll/list.tsx` handlePrint）: `#payroll-print-root` に画面用 `display:none` を追加し画面残留を根絶（[index.css]）。手当/控除の取得中は印刷不可にし、エラーは alert→トースト化。afterprint に加え setTimeout フォールバックでポータルを撤去。`console.log`/`alert` を全除去（`payslip-print-classic.tsx` のデバッグログ含む）。
  - 帳票（`payslip-print-classic.tsx` ClassicContent、単票・一括共通）: ①自動計算項目と同名のカスタム手当を支給欄から除外（BW社員で同名カスタム手当が二重表示される問題）。②勤怠列「出勤日数」→「平日日数」。③控除の「社会保険料（健保・厚年）」を「健康保険料」「厚生年金保険料」に分割表示（payroll には合算値のみ保存のため、標準報酬月額×令和8年料率で健保分を算出し、残りを厚年分として合計を社保合計に一致させる）。
  - ※ ①は根本的にはデータ重複（横井に BW 自動計算項目と同名のカスタム手当が登録）で、総支給・差引にも二重計上される。表示ガードで印刷は直るが、正しくは該当社員の「手当・控除」パネルで重複カスタム手当を削除→再計算が必要。
- 2026-07-09 二重計上の重複検知ガードを追加（`components/allowance-input-panel.tsx`）。給与計算で自動支給される項目名（基本給/土曜出勤手当/早出残業手当/職務手当/休日出勤手当/深夜手当/時間外手当/歩合給/固定残業代 = `RESERVED_PAY_ITEM_NAMES`）と同名のカスタム手当が社員に付いている場合、手当・控除パネル上部に赤い警告（「二重計上の可能性。この行を削除して再計算」）を表示。このパネルは給与明細の明細シートと月次実績の手当タブで共有のため両方に出る。横井のような「BW自動項目と同名カスタム手当」による二重計上の再発を防止。
- 2026-07-09 一括印刷は「1人1ページの詳細明細」のみ（`PayslipBulkPrint`＝`BulkItem` を人数分、`height:100vh`／`page-break`）。**面付け（複数枚を1ページ）はアプリ側で実装しない**方針に決定。理由: 自前の縮小面付け（`transform:scale`/実寸mm固定/実測フィット）は印刷時の `100vh` 不安定・`ClassicContent` の `overflow:hidden` 内部クリップ等で見切れが解消しきれず、**ブラウザ標準の「1枚あたりのページ数（pages per sheet, 1/2/4/6/9/16）」**の方が確実・綺麗に同一明細を縮小タイルできるため。ユーザー合意のうえ自前面付け（セレクタ・`MiniPayslip`・`perPage`・@page余白変更・画面外配置）は撤去し、`@page margin:8mm`／`#payroll-print-root{display:none}` に復帰。一括印刷ボタンの `title` で「面付けは印刷ダイアログの『1枚あたりのページ数』で」と案内。
- ※ payroll-app パッケージは本変更以前から typecheck 未通過（`Company` 生成型に `dailyWageWeekday` 等が無い・`salaryType` から `"hourly"` が消えている等、進行中リファクタ由来の既存エラー多数）。本変更は新規エラーを追加していない。→ **2026-07-13 に解消（下記）**。
- 2026-07-13 残存していた型エラー4件を解消し、payroll-app の typecheck が通る状態に復帰:
  - `date-parts-input.tsx`: `React.HTMLAttributes<HTMLDivElement>` の `onChange`(FormEventHandler) と独自の `onChange(value: string)` がシグネチャ衝突していたため継承時に `Omit`。
  - `driver.tsx`: メッセージ取得時の型注釈に `employeeId` が欠けており state 型と不一致 → 追加。`applicationServerKey` を `BufferSource` として渡す（`messages.tsx` と同処置）。
  - `office.tsx`: 打刻フィードバック音が `messageId` 必須の `playNotificationSound()` を**引数なし**で呼んでいた（型エラーかつ実バグ: `notifiedMessageIds` に `undefined` が登録され2回目以降鳴らない）。用途が違うため汎用の `playFeedbackSound()` を `lib/notification-sound.ts` に切り出して使用。
- 2026-07-13 給与明細の表示不具合3件を修正:
  - **残業時間が `3.1666666666666665時間` と表示される**。分単位残業（`overtimeUnitMinutes`/`overtimeUnitRate`、例: 清水=10分単位×2,031円）の社員は UI が「回」で入力させる一方 DB には時間換算で保存するため循環小数になる（19回 → 19×10/60）。`lib/format.ts` に `formatHours()`（分に丸めて「n時間m分」）を追加し、印刷（`payslip-print-classic.tsx`）と `payroll/detail.tsx` の双方に適用。金額は元から正しい（¥2,031×19回=¥38,589）ため計算に影響なし。
  - **業績手当（BWの解答C）が支給欄に出ない**。総支給には含まれるのに行が無く、支給項目の合計が総支給額と一致しなかった。印刷に行を追加。原因は `openapi.yaml` の `Payroll` に `performanceAllowance` が未定義で、API は値を返しているのにフロントの生成型から見えなかったこと（→ api-spec 側で追加・codegen）。
  - `payroll/detail.tsx` も同様に業績手当と**固定残業代（BW社員は職務手当）**の行が欠けており支給合計が合っていなかったため追加。
- 2026-07-13 ※ 横井（EMP010）2026/6 の「早出残業手当・職務手当・休日出勤手当が印刷でダブる」件は表示バグではなく**実際の二重計上**であることを実データで確認（総支給 610,599 = 基本給+土曜+超過残業+固定残業代+**カスタム手当全額**+業績手当 でぴったり一致）。ユーザー判断により、コード変更ではなく他の6月社員と同じく **manual モードで確定し直す**運用で解消する方針に決定（manual では自動計算分が0になりカスタム手当のみ計上、総支給 451,488 で合計一致）。
