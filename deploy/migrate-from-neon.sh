#!/bin/sh
# Neon → NAS の Postgres へ全データを移行する。
#
#   使い方（NAS の deploy/ ディレクトリで）:
#     NEON_URL='postgresql://neondb_owner:...@ep-....aws.neon.tech/neondb?sslmode=require' \
#       sh ./migrate-from-neon.sh
#
# 何をするか:
#   1. Neon から全体を pg_dump（カスタム形式）→ ./backups/neon-<日時>.dump
#   2. NAS の db コンテナへ pg_restore（--clean --if-exists で冪等）
#   3. 主要テーブルの件数を Neon と NAS で突き合わせて検証
#
# Neon 側は一切変更しない（読むだけ）。検証が通るまで Neon は消さないこと＝ロールバック先。
set -eu

if [ -z "${NEON_URL:-}" ]; then
  echo "ERROR: 環境変数 NEON_URL に Neon の接続文字列を渡してください" >&2
  exit 1
fi

cd "$(dirname "$0")"
[ -f .env ] || { echo "ERROR: deploy/.env がありません" >&2; exit 1; }
# shellcheck disable=SC1091
. ./.env

TS=$(date +%Y%m%d-%H%M%S)
DUMP="neon-${TS}.dump"

echo "==> db コンテナを起動"
docker compose up -d db
until docker compose exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  echo "    ... db の起動待ち"; sleep 2
done

echo "==> 1/3 Neon からダンプ（Neon は読むだけ）"
docker compose exec -T -e PGSSLMODE=require db \
  pg_dump "$NEON_URL" -Fc --no-owner --no-privileges -f "/backups/${DUMP}"
echo "    → deploy/backups/${DUMP}"

echo "==> 2/3 NAS の Postgres へリストア"
docker compose exec -T db \
  pg_restore --clean --if-exists --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" "/backups/${DUMP}"

echo "==> 3/3 検証: 主要テーブルの件数を突き合わせ"
COUNT_SQL="select 'employees' t, count(*) n from employees
  union all select 'payrolls', count(*) from payrolls
  union all select 'monthly_records', count(*) from monthly_records
  union all select 'employee_allowances', count(*) from employee_allowances
  union all select 'employee_deductions', count(*) from employee_deductions
  union all select 'allowance_definitions', count(*) from allowance_definitions
  union all select 'attendance_records', count(*) from attendance_records
  union all select 'messages', count(*) from messages
  union all select 'system_users', count(*) from system_users
  order by 1"

echo "--- Neon ---"
docker compose exec -T db psql "$NEON_URL" -At -F' ' -c "$COUNT_SQL" | tee /tmp/neon_counts.txt
echo "--- NAS ----"
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F' ' -c "$COUNT_SQL" | tee /tmp/nas_counts.txt

if diff -u /tmp/neon_counts.txt /tmp/nas_counts.txt >/dev/null; then
  echo ""
  echo "✅ 件数が完全に一致しました。移行成功です。"
  echo "   deploy/.env の DATABASE_URL が db を指していることを確認して:"
  echo "     docker compose up -d --build"
  echo "   ※ 実際にログイン・給与明細の表示まで確認できるまで Neon は消さないこと。"
else
  echo ""
  echo "❌ 件数が一致しません。DATABASE_URL は Neon のままにして、原因を調べてください。" >&2
  diff -u /tmp/neon_counts.txt /tmp/nas_counts.txt || true
  exit 1
fi
