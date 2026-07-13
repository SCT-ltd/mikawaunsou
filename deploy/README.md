# NAS + Cloudflare Tunnel デプロイ手順

三川運送システムを Synology NAS 上で動かし、Cloudflare Tunnel（Zero Trust）でインターネットに公開する。

```
[インターネット] → Cloudflare → cloudflared → web(nginx) → api(Express) → db(Postgres)
                                    ↑
                        NASからの outbound 接続のみ。
                        ルーターのポート開放は一切不要。
```

| ホスト | 用途 | Cloudflare Access |
|---|---|---|
| `mikawa-unso.jp` | ドライバー/事務所の**QR打刻画面のみ** | **掛けない**（掛けるとドライバーが弾かれる） |
| `admin.mikawa-unso.jp` | 管理画面（給与・社員・勤怠 …） | **掛ける**（メール認証） |

公開ホストでは nginx が管理画面と管理APIを 403/404 で塞いでいる。インターネットから
未認証で到達できるのは QR打刻に必要なエンドポイントだけ。

---

## 1. NAS にソースを置く

SSH で NAS に入り、`/volume2/docker/mikawa-system` にリポジトリを配置する。

```sh
cd /volume2/docker
git clone <このリポジトリのURL> mikawa-system
cd mikawa-system/deploy
```

## 2. Cloudflare でトンネルを作る

1. Cloudflare ダッシュボード → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**
2. コネクタは **Cloudflared** を選択。名前は `mikawa-system` など
3. 表示される**トークン**（`eyJ...` の長い文字列）をコピー → 手順3の `TUNNEL_TOKEN` に貼る
4. **Public Hostnames** に2つ登録する（DNSレコードは自動で作られる）

   | Subdomain | Domain | Type | URL |
   |---|---|---|---|
   | （空欄） | `mikawa-unso.jp` | HTTP | `web:80` |
   | `admin` | `mikawa-unso.jp` | HTTP | `web:80` |

   > URL は `http://web:80` ではなく `web:80` でよい（Type=HTTP のため）。
   > 2つとも同じ `web` を指す。nginx が Host ヘッダーで振り分ける。

## 3. `.env` を作る

```sh
cp .env.example .env
vi .env
```

- `SESSION_SECRET` … `openssl rand -hex 32` で生成
- `POSTGRES_PASSWORD` … 長いランダム文字列
- `VAPID_*` … **今使っている鍵をそのまま入れる**（変えると既存のプッシュ購読が全部無効になる）
- `TUNNEL_TOKEN` … 手順2でコピーしたトークン
- `PUBLIC_ORIGIN` … `https://mikawa-unso.jp`（QRコードが指すURL。**admin を入れないこと**）

## 4. Neon から DB を移行する

Neon 側は読むだけで、一切変更しない。**検証が通るまで Neon は消さない**（ロールバック先）。

```sh
NEON_URL='postgresql://neondb_owner:...@ep-....aws.neon.tech/neondb?sslmode=require' \
  sh ./migrate-from-neon.sh
```

主要テーブルの件数を Neon と NAS で突き合わせ、一致しなければ中断する。
失敗したら `.env` の `DATABASE_URL` を Neon のままにしておけば従来通り動く。

## 5. 起動

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f cloudflared   # "Registered tunnel connection" が出れば疎通OK
```

## 6. Cloudflare Access で管理画面を保護する

1. **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**
2. Application name: `三川運送 管理画面`
3. Public hostname: `admin.mikawa-unso.jp`
4. Policy:
   - Action: **Allow**
   - Include: **Emails** → 事務所の担当者のメールアドレスを列挙
     （または **Emails ending in** → `@自社ドメイン`）
5. 保存

> **`mikawa-unso.jp`（apex）には Access アプリを作らないこと。**
> 作るとドライバーがQRを読んだ瞬間に Cloudflare のログイン画面に飛ばされ、打刻できなくなる。

これで管理画面は「Cloudflare Access のメール認証」→「アプリのログイン画面」の二段階になる。

## 7. 動作確認

```
□ https://mikawa-unso.jp/driver/<社員ID>   → PIN画面が出る（Cloudflareのログインを求められないこと）
□ https://mikawa-unso.jp/                  → 404（管理画面が出ないこと）
□ https://mikawa-unso.jp/api/auth/login    → 403（ログインAPIが露出していないこと）
□ https://admin.mikawa-unso.jp/            → Access のメール認証 → アプリのログイン画面
□ 管理画面にログイン → 給与明細が表示される（＝DB移行が成功している）
□ 勤怠画面でQRを発行 → URLが https://mikawa-unso.jp/... になっている（admin. でないこと）
```

---

## 更新のしかた（★通常はこれだけ）

**開発機（Windows）から1コマンド。**

```powershell
powershell -File deploy/update-nas.ps1              # api と web の両方
powershell -File deploy/update-nas.ps1 -Only web    # フロント/nginx だけ変えたとき
powershell -File deploy/update-nas.ps1 -Only api    # バックエンドだけ変えたとき
```

やっていること:

1. 開発機で `linux/amd64` のイメージをビルド（NAS は x86_64 の Synology）
2. `docker save | gzip` → SCP で NAS へ転送
3. NAS で `docker load` → `docker compose up -d --force-recreate`
4. **インターネット経由で疎通検証**（QRが開く / 管理APIが 403 / 管理ホストが Access へ転送）。1つでも落ちたら失敗で終わる

NAS 上でビルドしないのは、Celeron の NAS でモノレポをビルドし直すより
**開発機で検証したイメージをそのまま動かす方が確実で速い**ため。

> パスワードを毎回聞かれたくないときは `$env:NAS_PASSWORD = "..."` を先に設定する。

### DBスキーマを変えたとき

`compose` は `drizzle-kit push` をしない。スキーマ（`lib/db/src/schema/`）を変えた場合は
**アップデート後に NAS 上で1回だけ** push する:

```sh
ssh kotaki@192.168.0.199
cd /volume2/docker/mikawa-system/app
# .env の DATABASE_URL は db コンテナ内の名前解決を使うので、ホストからは compose 経由で叩く
sudo /usr/local/bin/docker compose -f deploy/docker-compose.yml run --rm \
  -e DATABASE_URL="postgresql://mikawa:<パスワード>@db:5432/mikawa" api \
  node -e "console.log('※ push は開発機から Neon 相当の接続文字列で行うのが簡単')"
```

> 実運用では、開発機から NAS の Postgres には直接届かない（ポート非公開）ため、
> スキーマ変更時は「NAS で一時的に db のポートを LAN に出して push → 閉じる」か、
> `pg_dump`/`psql` で DDL を当てる。**ポートを出したままにしないこと。**

### NAS 上で直接ビルドしたい場合（通常は不要）

ソースは `/volume2/docker/mikawa-system/app` にある。

```sh
cd /volume2/docker/mikawa-system/app/deploy
sudo /usr/local/bin/docker compose up -d --build
```

## バックアップ

`db-backup` コンテナが**毎日** `deploy/backups/mikawa-<日時>.dump` を出力する（既定60日保持）。
給与データは法定保存対象なので、`deploy/backups/` を Synology の Hyper Backup で
**NAS外（クラウド/外付けHDD）にも**複製すること。NAS故障＝喪失、にしない。

手動バックアップ:
```sh
docker compose exec db pg_dump "$DATABASE_URL" -Fc -f /backups/manual-$(date +%Y%m%d).dump
```

リストア:
```sh
docker compose exec db pg_restore --clean --if-exists -U mikawa -d mikawa /backups/<ファイル>.dump
```

## ロールバック（DBをNeonに戻す）

`.env` の `DATABASE_URL` を Neon の接続文字列に戻して `docker compose up -d api` するだけ。

---

## 触るときの注意

- **公開APIの allowlist は2箇所にある。** `deploy/nginx/default.conf` の正規表現と、
  `artifacts/api-server/src/routes/index.ts` の `isPublicDriverFlowRequest()`。
  QR画面が叩くエンドポイントを増やしたら**両方**直すこと。nginx 側を忘れると 403 で無言で壊れる。
- **SSE（`/api/attendance/stream`, `/api/messages/stream`）はバッファリング禁止。**
  `deploy/nginx/proxy.conf` の `proxy_buffering off` を消すとリアルタイム更新が止まる。
- **NAS 側でポートを公開しない。** `docker-compose.yml` に `ports:` を足すと、
  Cloudflare を迂回して LAN に直接晒すことになる。
