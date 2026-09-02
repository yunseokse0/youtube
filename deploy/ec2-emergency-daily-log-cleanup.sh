#!/usr/bin/env bash
# [1단계 긴급] 23MB daily-log monolith I/O 즉시 차단 + shard 마이그레이션
#
#   cd ~/youtube && bash deploy/ec2-emergency-daily-log-cleanup.sh
#   bash deploy/ec2-emergency-daily-log-cleanup.sh --skip-migrate   # SQL stub만
#   bash deploy/ec2-emergency-daily-log-cleanup.sh --user=din
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

USER_ID="${USER_ID:-din}"
SKIP_MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --user=*) USER_ID="${arg#*=}" ;;
  esac
done

MONO_KEY="excel-broadcast-daily-log-v1:${USER_ID}"
BAK_KEY="${MONO_KEY}:OLD_EMERGENCY_BAK"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

read_db_creds() {
  if [[ -f "$ROOT/.env" ]] && grep -q '^DATABASE_URL=' "$ROOT/.env"; then
    DB_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '\r"')"
    if [[ "$DB_URL" =~ mysql://([^:]+):([^@]+)@[^/]+/([^?]+) ]]; then
      DB_USER="${BASH_REMATCH[1]}"
      DB_PASS="${BASH_REMATCH[2]}"
      DB_NAME="${BASH_REMATCH[3]}"
      return 0
    fi
  fi
  if [[ -f /etc/mysql/youtube-app.cnf ]]; then
    DB_USER="$(grep -E '^user=' /etc/mysql/youtube-app.cnf | head -1 | cut -d= -f2- | tr -d ' ')"
    DB_PASS="$(grep -E '^password=' /etc/mysql/youtube-app.cnf | head -1 | cut -d= -f2- | tr -d ' ')"
    DB_NAME="youtube"
    return 0
  fi
  echo "ERROR: DATABASE_URL 또는 /etc/mysql/youtube-app.cnf 필요"
  exit 1
}

mysql_q() {
  mysql --protocol=socket -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -e "$1"
}

echo "=========================================="
echo " [1단계] daily-log 긴급 청소 user=${USER_ID}"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

read_db_creds

BYTES="$(mysql_q "SELECT COALESCE(CHAR_LENGTH(v),0) FROM app_kv WHERE k='${MONO_KEY}' LIMIT 1;" 2>/dev/null || echo "0")"
echo "monolith ${MONO_KEY}: ${BYTES} bytes"

if [[ "${BYTES:-0}" -lt 1000 ]]; then
  echo "monolith 이미 슬림 — 마이그레이션만 시도"
else
  echo "== 1. OLD_EMERGENCY_BAK 백업 =="
  mysql_q "
INSERT INTO app_kv (k, v, expires_at, updated_at)
SELECT '${BAK_KEY}', v, NULL, UNIX_TIMESTAMP()*1000
FROM app_kv WHERE k='${MONO_KEY}'
ON DUPLICATE KEY UPDATE v=VALUES(v), updated_at=VALUES(updated_at);
"
  echo "backup OK → ${BAK_KEY}"
fi

if [[ "$SKIP_MIGRATE" == "0" ]] && [[ -f "$ROOT/scripts/migrate-daily-log-shards.mjs" ]]; then
  echo "== 2. 일별 shard 마이그레이션 =="
  node "$ROOT/scripts/migrate-daily-log-shards.mjs" --user="${USER_ID}" || {
    echo "WARN: migrate 실패 — stub 교체로 I/O 병목만 해소"
  }
fi

echo "== 3. monolith stub 교체 (즉시 I/O 해소) =="
NOW_MS="$(date +%s)000"
STUB="{\"__migrated\":true,\"emergency\":true,\"at\":${NOW_MS},\"bakKey\":\"${BAK_KEY}\"}"
mysql_q "
UPDATE app_kv SET v='${STUB}', updated_at=${NOW_MS} WHERE k='${MONO_KEY}';
"
AFTER="$(mysql_q "SELECT COALESCE(CHAR_LENGTH(v),0) FROM app_kv WHERE k='${MONO_KEY}' LIMIT 1;" 2>/dev/null || echo "?")"
echo "monolith after: ${AFTER} bytes"

echo "== 4. MySQL timeout (선택) =="
if [[ -f "$ROOT/deploy/ec2-mysql-stabilize.sh" ]]; then
  bash "$ROOT/deploy/ec2-mysql-stabilize.sh" || echo "WARN: mysql stabilize 스킵"
fi

echo "== 5. 코드 배포 (Pool 6/2 · shard · lite storage-health) =="
git pull --ff-only || true
export PM2_STOP_BEFORE_BUILD=0
SKIP_GIT_PULL=1 bash "$ROOT/deploy/deploy-on-ec2.sh" || {
  echo "WARN: deploy 실패 — pm2 reload 시도"
  pm2 reload youtube --update-env 2>/dev/null || pm2 restart youtube --update-env
}

echo "== 6. 검증 =="
sleep 6
curl -sf --max-time 5 "http://127.0.0.1:3000/api/health?deep=1" | head -c 400 || true
echo ""
curl -sf --max-time 8 -w "\nHTTP: %{http_code} Time: %{time_total}s\n" \
  "http://127.0.0.1:3000/api/state?user=${USER_ID}&u=${USER_ID}&fast=1&_t=$(date +%s)" \
  -o /dev/null || true

echo ""
echo "완료 — shard 키 확인:"
mysql_q "SELECT k, CHAR_LENGTH(v) AS bytes FROM app_kv WHERE k LIKE '${MONO_KEY}:%' ORDER BY k DESC LIMIT 10;" 2>/dev/null || true
