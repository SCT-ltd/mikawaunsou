# メッセージページ 刷新設計書

日付: 2026-07-02
対象: `artifacts/payroll-app/src/pages/messages.tsx`（534行）
承認: ユーザー承認済み（視覚トーン・タイポ・全幅化・一貫性の刷新。検索追加・一斉送信の Dialog 化を含む）

## 目的
既にマスターディテール型（左=会話一覧・右=チャット）のメッセンジャーを、他ページと統一した全幅・洗練トーン・タイポに刷新。**API・SSE・通知音/Push・既読処理・一斉送信ロジックは変更しない**。

## 変更点
1. 全幅化: 負マージンハック（`-m-3 md:-m-6…`）を廃し `AppLayout fullWidth` ＋角丸カードパネル・共通の高さ計算に統一
2. 洗練トーン: アバターを淡色トーン（氏名頭文字ベース単色、他ページと統一）に。バブル・パネルの角丸/境界/余白を整流
3. タイポ: 氏名・見出しに jp-tight、時刻・未読カウントに amount（等幅数字）
4. 会話一覧に検索を追加（氏名・部署）
5. 一斉送信モーダルを Dialog コンポーネント化（中身のロジックは維持）

## ファイル構成
| ファイル | 内容 |
|---|---|
| `pages/messages.tsx` | 状態・SSE・送信/既読/Push/一斉送信ハンドラ・レイアウト |
| `components/messages/conversation-list.tsx` | 左ペイン（検索・会話行・アバター・未読ソート） |
| `components/messages/chat-view.tsx` | 右チャット（ヘッダー・バブル・入力欄） |
| `components/messages/broadcast-dialog.tsx` | 一斉送信ダイアログ |
| `components/messages/shared.tsx` | 型・formatTime・Avatar |

## 機能維持（挙動パリティ）
SSE 受信・重複排除・通知音（社員メッセージのみ・playNotificationSound）・既読処理（開いている会話は即既読/他はカウント）・未読ソート・Push 許可/登録（registerPush/urlBase64ToUint8Array）・一斉送信（送信先選択・全員選択・count 表示）・自動スクロール・Enter送信/Shift+Enter改行・音声アンロック・モバイル list↔chat 切替。

## 変更しないもの
API エンドポイント・SSE・通知音/Push・既読処理・一斉送信・メッセージ表示ロジック
