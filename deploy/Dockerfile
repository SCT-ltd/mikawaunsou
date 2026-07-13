# syntax=docker/dockerfile:1
#
# 三川運送システム 本番イメージ（NAS / Cloudflare Tunnel 用）
#
#   target=api  … Express API（esbuild で単一 ESM にバンドル済み）
#   target=web  … nginx（SPA の静的配信 + /api のリバースプロキシ）
#
# ビルドは必ずリポジトリのルートを context にすること:
#   docker build -f deploy/Dockerfile --target api -t mikawa-api .

# ─────────────────────────────────────────────────────────────
# builder: pnpm workspace をまとめてビルド
# ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /repo

# 依存解決に必要なマニフェストだけ先に入れてレイヤキャッシュを効かせる
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY artifacts/api-server/package.json   artifacts/api-server/
COPY artifacts/payroll-app/package.json  artifacts/payroll-app/
COPY lib/api-client-react/package.json   lib/api-client-react/
COPY lib/api-spec/package.json           lib/api-spec/
COPY lib/api-zod/package.json            lib/api-zod/
COPY lib/db/package.json                 lib/db/
COPY lib/tax-tables-reiwa8/package.json  lib/tax-tables-reiwa8/
COPY scripts/package.json                scripts/

RUN pnpm install --frozen-lockfile

COPY . .

# API: esbuild で dist/index.mjs（依存を内包した単一 ESM）を生成
RUN pnpm --filter @workspace/api-server run build

# SPA: vite build。vite.config.ts は PORT と BASE_PATH が無いと throw する。
#   VITE_PUBLIC_ORIGIN … QRコードが指す「公開ホスト」。管理画面は Access の背後にあるため、
#                        ここを指定しないと QR が admin.* を指してドライバーが弾かれる。
ARG VITE_PUBLIC_ORIGIN=""
ENV PORT=5173 \
    BASE_PATH=/ \
    VITE_PUBLIC_ORIGIN=${VITE_PUBLIC_ORIGIN}
RUN pnpm --filter @workspace/payroll-app run build


# ─────────────────────────────────────────────────────────────
# api: Express API ランタイム
# ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS api

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

# esbuild が依存を内包しているので node_modules は不要（dist のみで動く）
COPY --from=builder /repo/artifacts/api-server/dist ./dist

USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]


# ─────────────────────────────────────────────────────────────
# web: nginx（SPA 配信 + /api リバースプロキシ）
# ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS web

COPY --from=builder /repo/artifacts/payroll-app/dist/public /usr/share/nginx/html
COPY deploy/nginx/proxy.conf   /etc/nginx/mikawa-proxy.conf
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
