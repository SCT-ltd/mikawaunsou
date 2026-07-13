# deploy — 本番デプロイ（NAS + Cloudflare Tunnel）

## これは何か

三川運送システムを自宅の Synology NAS（`/volume2/docker/mikawa-system`）で動かし、
Cloudflare Tunnel（Zero Trust）経由でインターネットに公開するための構成一式。
NAS 側はポートを一切開けず、cloudflared が Cloudflare へ張る outbound 接続だけが入口。

```
[インターネット] → Cloudflare → cloudflared → web(nginx) → api(Express) → db(Postgres)
```

## 主要ファイル

- `Dockerfile` — マルチステージ。`target=api`（esbuild 済み単一 ESM を node で実行）と
  `target=web`（nginx + vite build 済み SPA）。ビルド context はリポジトリのルート。
- `nginx/default.conf` — **2ホストを1つの nginx で捌く**。`admin.*` → 管理ホスト（全機能）、
  それ以外（default_server）→ 公開ホスト（QR打刻のみ）。ドメインはハードコードしていない。
- `nginx/proxy.conf` — `/api` プロキシの共通設定。SSE のため `proxy_buffering off`。
- `docker-compose.yml` — `db` / `api` / `web` / `cloudflared` / `db-backup`。`ports:` は意図的に無し。
- `migrate-from-neon.sh` — Neon → NAS Postgres の移行＋件数突き合わせ検証。
- `README.md` — 手順書（Cloudflare 設定・Access ポリシー・動作確認・ロールバック）。

## 現在のステータス

- 2026-07-13 実装。ローカル（Docker Desktop）で **api / web 両イメージのビルドと起動、
  ホスト振り分け・公開API allowlist・SPA配信を実測で検証済み**。NAS 上での実デプロイは未実施。

## 決定事項

- 2026-07-13 **公開ホストと管理ホストを分ける**方針に決定（ユーザー合意）。QR打刻画面
  （`/driver/:id`, `/office/:id`）は未ログインで動く必要があるため、サイト全体に Cloudflare Access
  を掛けることができない。そこで:
  - `mikawa-unso.jp`（公開）… nginx が QR画面と**公開APIの allowlist だけ**を通し、管理画面は 404、
    管理API（`/api/auth/login`, `/api/payroll` 等）は 403 で塞ぐ。Access は掛けない。
  - `admin.mikawa-unso.jp`（管理）… 全機能。Cloudflare Access（メール認証）で保護。
  - 検証結果（ローカル実測）: 公開ホストで `/driver/25`=200 / `/api/employees/25`=200 /
    `/api/auth/login`=403 / `/api/payroll`=403 / `/`=404、管理ホストで全て到達可。
- 2026-07-13 **公開APIの allowlist は `routes/index.ts` の `isPublicDriverFlowRequest()` と
  nginx の正規表現の2箇所に存在する**（意図的な二重化）。エッジで塞ぐことに意味があるため許容するが、
  QR画面が叩くエンドポイントを増減したら両方直すこと。片方だけ直すと 403 で無言で壊れる。
- 2026-07-13 **QRコードのURL生成を公開ホスト固定にした**（`VITE_PUBLIC_ORIGIN`）。従来は
  `window.location.origin` から作っており、管理画面（`admin.*`）でQRを発行すると QR が admin を指し、
  ドライバーが Cloudflare Access に弾かれて打刻できなくなるため。未設定時は従来通り現在のオリジン。
- 2026-07-13 **本番のみ secure Cookie + `trust proxy`** を有効化（`app.ts`）。Cloudflare が TLS を終端し
  cloudflared → nginx は平文のため、`X-Forwarded-Proto: https` を nginx が付け Express がそれを信頼する。
  これが無いと `secure: true` の Cookie が発行されずログインできない。開発（NODE_ENV≠production）は従来通り。
- 2026-07-13 DB は **Neon → NAS の Postgres へ移行**しつつ、`.env` の `DATABASE_URL` 1行で
  Neon に戻せる構成にした（検証が済むまで Neon をロールバック先として残す）。給与データは法定保存対象のため
  `db-backup` コンテナで日次 `pg_dump`（既定60日保持）。NAS 外への複製は Hyper Backup で行う運用。

## 既知の問題（デプロイとは別件・未修正）

- 2026-07-13 **QR画面の SSE と Web Push 購読が未ログインでは動かない**（既存の不具合。本デプロイ作業で発覚）。
  PIN認証（`POST /employees/:id/pin/verify`）はセッションを張らず `{ok}` を返すだけなので、QR画面の利用者は
  常に未ログイン。一方 `GET /attendance/stream`・`GET /messages/stream`・`POST /push/subscribe` の
  ハンドラは `req.session.userId` を要求するため 401 になる。
  - 影響: 打刻・チェックリスト・メッセージの閲覧/送信は**正常に動く**（未ログインで 200 を実測）。
    動かないのは画面のリアルタイム更新（SSE）とプッシュ通知の購読。
  - `isPublicDriverFlowRequest()` はこれら3つを許可しており、nginx の allowlist にも入れてある。
    ハンドラ側のセッション要求を公開フロー対応にすれば直る想定（※未着手）。
