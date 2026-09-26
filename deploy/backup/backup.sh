#!/bin/sh
# 給与DBの日次バックアップ＋定期的な復元テスト（db-backup コンテナで動く）
#
# 毎日 BACKUP_HOUR 時（JST）以降に1回:
#   1. pg_dump で /backups/mikawa-<日時>.dump を作る（書き終わるまでは .partial）
#   2. pg_restore --list で読めることを確かめてから本来の名前にする
#   3. BACKUP_RETENTION_DAYS 日より古いダンプを消す
# 週1回（BACKUP_VERIFY_WEEKDAY、1=月〜7=日）と初回起動時:
#   4. 使い捨てのDB（mikawa_restore_check）へ実際に復元し、主要テーブルの件数を本番と突き合わせてから消す
#
# 結果は /backups/_status/ に残す（last_ok・last_verify_ok・last_error）。
# BACKUP_ALERT_WEBHOOK（Discord / Slack の Incoming Webhook URL）を設定すると、失敗時と復元テストの結果を通知する。
#
# ⚠ ここで守れるのは「ダンプが壊れていないこと」まで。NAS そのものが壊れたら消えるので、
#   /backups を Hyper Backup で NAS の外へ複製すること（deploy/README.md「バックアップ」）。

set -u

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-60}"
BACKUP_HOUR="${BACKUP_HOUR:-3}"
VERIFY_WEEKDAY="${BACKUP_VERIFY_WEEKDAY:-7}"
WEBHOOK="${BACKUP_ALERT_WEBHOOK:-}"
DIR=/backups
STATUS="$DIR/_status"
CHECK_DB=mikawa_restore_check
# 件数を突き合わせるテーブル（給与の法定保存に関わるもの）
CHECK_TABLES="employees payrolls monthly_records attendance_records"

mkdir -p "$STATUS"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# 通知。本文に引用符を入れない（JSON をエスケープしていないため）
notify() {
  log "$1"
  [ -z "$WEBHOOK" ] && return 0
  msg="[三川運送 給与DB] $1"
  wget -q -O /dev/null -T 20 --header 'Content-Type: application/json' \
    --post-data "{\"content\":\"$msg\",\"text\":\"$msg\"}" "$WEBHOOK" \
    || log "通知の送信に失敗しました"
}

fail() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" > "$STATUS/last_error"
  notify "失敗: $1（詳細は docker compose logs db-backup）"
}

# DATABASE_URL の DB 名だけを差し替えた接続文字列
url_for_db() {
  echo "$DATABASE_URL" | sed -E "s#/[^/?]+(\?|\$)#/$1\1#"
}

dump() {
  ts=$(date +%Y%m%d-%H%M%S)
  out="$DIR/mikawa-$ts.dump"
  if ! pg_dump "$DATABASE_URL" -Fc -f "$out.partial"; then
    rm -f "$out.partial"; fail "pg_dump が失敗しました"; return 1
  fi
  if ! pg_restore --list "$out.partial" > /dev/null 2>&1; then
    rm -f "$out.partial"; fail "ダンプが読めません（壊れています）"; return 1
  fi
  mv "$out.partial" "$out"
  size=$(du -k "$out" | cut -f1)
  echo "$(date '+%Y-%m-%d %H:%M:%S') mikawa-$ts.dump ${size}KB" > "$STATUS/last_ok"
  rm -f "$STATUS/last_error"
  log "ok: mikawa-$ts.dump (${size}KB)"
  find "$DIR" -maxdepth 1 -name 'mikawa-*.dump' -mtime +"$RETENTION_DAYS" -delete
  find "$DIR" -maxdepth 1 -name 'mikawa-*.dump.partial' -mtime +1 -delete
  LAST_DUMP="$out"
  return 0
}

count_rows() { # $1=接続文字列 $2=テーブル
  psql "$1" -At -c "select count(*) from $2" 2>/dev/null
}

verify() {
  file="$1"
  admin=$(url_for_db postgres)
  check=$(url_for_db "$CHECK_DB")
  log "復元テスト: $(basename "$file") → $CHECK_DB"
  psql "$admin" -q -c "DROP DATABASE IF EXISTS $CHECK_DB" -c "CREATE DATABASE $CHECK_DB" > /dev/null 2>&1 \
    || { fail "復元テスト用のDBを作れません（接続ユーザーに CREATEDB 権限が必要）"; return 1; }
  if ! pg_restore --no-owner --no-privileges --exit-on-error -d "$check" "$file" > /dev/null 2>&1; then
    psql "$admin" -q -c "DROP DATABASE IF EXISTS $CHECK_DB" > /dev/null 2>&1
    fail "復元テストが失敗しました（$(basename "$file")）"; return 1
  fi
  report=""
  ok=1
  for t in $CHECK_TABLES; do
    restored=$(count_rows "$check" "$t")
    live=$(count_rows "$DATABASE_URL" "$t")
    report="$report $t=$restored/$live"
    # ダンプ後に増えた分があるので「復元 ≦ 本番」かつ極端に少なくないこと（本番の9割以上）を確かめる
    if [ -z "$restored" ] || [ -z "$live" ] || [ "$restored" -gt "$live" ] || [ $((restored * 10)) -lt $((live * 9)) ]; then
      ok=0
    fi
  done
  psql "$admin" -q -c "DROP DATABASE IF EXISTS $CHECK_DB" > /dev/null 2>&1
  if [ "$ok" -ne 1 ]; then
    fail "復元テストの件数が合いません（復元/本番:$report）"; return 1
  fi
  echo "$(date '+%Y-%m-%d %H:%M:%S') $(basename "$file")$report" > "$STATUS/last_verify_ok"
  notify "復元テスト OK: $(basename "$file")（復元/本番:$report）"
  return 0
}

log "started (hour=${BACKUP_HOUR} retention=${RETENTION_DAYS}d verify_weekday=${VERIFY_WEEKDAY} webhook=$([ -n "$WEBHOOK" ] && echo on || echo off))"

while true; do
  today=$(date +%Y%m%d)
  hour=$(date +%H | sed 's/^0//')
  done_day=$(cat "$STATUS/done_day" 2>/dev/null || echo "")
  if [ "$done_day" != "$today" ] && [ "${hour:-0}" -ge "$BACKUP_HOUR" ]; then
    LAST_DUMP=""
    if dump; then
      echo "$today" > "$STATUS/done_day"
      if [ "$(date +%u)" = "$VERIFY_WEEKDAY" ] || [ ! -f "$STATUS/last_verify_ok" ]; then
        verify "$LAST_DUMP"
      fi
    else
      # 失敗した日は1時間おきにやり直す
      sleep 3000
    fi
  fi
  sleep 600
done
