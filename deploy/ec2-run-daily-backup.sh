#!/usr/bin/env bash
# EC2 일일 백업 실행 — KV state JSON + MySQL mysqldump 압축 저장 + N일치 보존
# cron.d 에서 매일 03:30 실행 (deploy/ec2-setup-backup.sh)
#
# 환경변수 (전부 선택):
#   BACKUP_DIR          저장 루트 (기본 ~/.din-studio/backup)
#   KEEP_STATE_DAYS     state JSON 백업 보관 일수 (기본 30)
#   KEEP_MYSQL_DAYS     MySQL mysqldump 보관 일수 (기본 14)
#   BACKUP_STATE_URL    state 백업할 엔드포인트 (기본 http://127.0.0.1:3000/api/state?u=finalent)
#   BACKUP_DEEPHEALTH_URL  백업 직전 health 확인 (기본 http://127.0.0.1:3000/api/health?deep=1)
#   MYSQL_DATABASE / MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD
#                       → 없으면 MySQL 백업 SKIP (state 만 백업)
#   DATABASE_URL        → 위 MYSQL_* 변수 대신 이것만 파싱해서 사용해도 OK
#   BACKUP_LOG          로그 경로 (기본 /var/log/youtube-backup.log)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="${BACKUP_DIR:-$HOME/.din-studio/backup}"
KEEP_STATE_DAYS="${KEEP_STATE_DAYS:-30}"
KEEP_MYSQL_DAYS="${KEEP_MYSQL_DAYS:-14}"
BACKUP_STATE_URL="${BACKUP_STATE_URL:-http://127.0.0.1:3000/api/state?u=finalent}"
BACKUP_DEEPHEALTH_URL="${BACKUP_DEEPHEALTH_URL:-http://127.0.0.1:3000/api/health?deep=1}"
BACKUP_LOG="${BACKUP_LOG:-/var/log/youtube-backup.log}"

STATE_DIR="${BACKUP_DIR}/state"
MYSQL_DIR="${BACKUP_DIR}/mysql"
RUN_TS="$(date '+%Y%m%d-%H%M%S')"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

log() {
  local line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line"
  echo "$line" >>"$BACKUP_LOG" 2>/dev/null || true
}

mkdir -p "$STATE_DIR" "$MYSQL_DIR"
touch "$BACKUP_LOG" 2>/dev/null || BACKUP_LOG="$HOME/youtube-backup.log"
touch "$BACKUP_LOG" 2>/dev/null || true

log "===== daily backup start $RUN_TS ====="

# 1. Health 확인 → 죽었는데 백업하면 깨진 JSON 저장되므로 skip
HEALTH_OK=0
if curl -sf --max-time 15 "$BACKUP_DEEPHEALTH_URL" >"$BACKUP_DIR/.deephealth.json" 2>/dev/null; then
  HEALTH_OK=1
else
  HEALTH_OK=0
  log "WARN deep health FAIL — 백업 계속하지만 로그에 남김"
fi

# 2. State JSON 백업 (항상 시도, deephealth 실패해도 스냅샷 남겨두는게 나을 수 있음)
STATE_FILE="${STATE_DIR}/state-${RUN_TS}.json"
STATE_SIZE=0
if curl -sf --max-time 30 "$BACKUP_STATE_URL" > "$STATE_FILE" 2>/dev/null; then
  STATE_SIZE=$(wc -c < "$STATE_FILE")
  # JSON 유효성 검증 + donors 건수 추출
  DONORS_N=$(python3 -c 'import json,sys
try:
  d=json.loads(open(sys.argv[1],encoding="utf-8",errors="replace").read())
  x=d.get("donors") or []
  print(len(x) if isinstance(x,list) else 0)
except Exception:
  print("PARSE_FAIL")
' "$STATE_FILE" 2>/dev/null || echo "PY_FAIL")
  if [[ "$DONORS_N" == "PARSE_FAIL" || "$DONORS_N" == "PY_FAIL" ]]; then
    log "FAIL state backup — invalid JSON at ${STATE_FILE} (size=${STATE_SIZE})"
    rm -f "$STATE_FILE"
  else
    gzip -f "$STATE_FILE" 2>/dev/null || true
    STATE_FILE_GZ="${STATE_FILE}.gz"
    if [[ -f "$STATE_FILE_GZ" ]]; then
      GZ_SIZE=$(wc -c < "$STATE_FILE_GZ")
      log "OK state backup: donors_n=${DONORS_N} raw=${STATE_SIZE}B gzip=${GZ_SIZE}B → ${STATE_FILE_GZ}"
    else
      log "OK state backup: donors_n=${DONORS_N} raw=${STATE_SIZE}B (no-gzip) → ${STATE_FILE}"
    fi
  fi
else
  log "FAIL state backup — curl FAIL ${BACKUP_STATE_URL}"
  rm -f "$STATE_FILE"
fi

# 3. MySQL 백업 (DATABASE_URL 또는 MYSQL_* 있을 때만)
parse_database_url_maybe() {
  if [[ -n "${DATABASE_URL:-}" ]] && [[ -z "${MYSQL_DATABASE:-}" ]]; then
    if command -v python3 >/dev/null 2>&1; then
      local parsed
      parsed=$(python3 - <<PY 2>/dev/null || true
import os, urllib.parse as u, sys
x=os.environ.get("DATABASE_URL","")
p=u.urlparse(x)
sys.stdout.write("\n".join([
  p.hostname or "",
  str(p.port or "3306"),
  p.username or "",
  p.password or "",
  (p.path or "/").lstrip("/") or "",
]))
PY
)
      if [[ -n "$parsed" ]]; then
        MYSQL_HOST="$(echo "$parsed" | awk 'NR==1')"
        MYSQL_PORT="$(echo "$parsed" | awk 'NR==2')"
        MYSQL_USER="$(echo "$parsed" | awk 'NR==3')"
        MYSQL_PASSWORD="$(echo "$parsed" | awk 'NR==4')"
        MYSQL_DATABASE="$(echo "$parsed" | awk 'NR==5')"
      fi
    fi
  fi
}
parse_database_url_maybe

MYSQL_FILE="${MYSQL_DIR}/mysql-${RUN_TS}.sql"
MYSQL_BACKUP_DONE=0
if [[ -n "${MYSQL_DATABASE:-}" ]] && command -v mysqldump >/dev/null 2>&1; then
  export MYSQL_PWD="${MYSQL_PASSWORD:-}"
  set +e
  mysqldump \
    --host="${MYSQL_HOST:-127.0.0.1}" \
    --port="${MYSQL_PORT:-3306}" \
    --user="${MYSQL_USER:-root}" \
    --single-transaction \
    --quick \
    --default-character-set=utf8mb4 \
    --routines --triggers \
    "${MYSQL_DATABASE}" > "$MYSQL_FILE" 2>>"$BACKUP_LOG"
  local_rc=$?
  set -e
  unset MYSQL_PWD
  if [[ $local_rc -eq 0 ]] && [[ -s "$MYSQL_FILE" ]]; then
    gzip -f "$MYSQL_FILE" 2>/dev/null || true
    if [[ -f "${MYSQL_FILE}.gz" ]]; then
      log "OK mysql backup: db=${MYSQL_DATABASE} gzip=$(wc -c < "${MYSQL_FILE}.gz")B → ${MYSQL_FILE}.gz"
    else
      log "OK mysql backup: db=${MYSQL_DATABASE} raw=$(wc -c < "$MYSQL_FILE")B → ${MYSQL_FILE}"
    fi
    MYSQL_BACKUP_DONE=1
  else
    log "FAIL mysql backup: db=${MYSQL_DATABASE} rc=${local_rc}. 파일 스킵"
    rm -f "$MYSQL_FILE"
  fi
else
  log "SKIP mysql backup — env/DATABASE_URL 없거나 mysqldump 명령어 없음 (state 만 백업 완료)"
fi

# 4. N일 이상된 백업 자동 삭제 (보존 정책)
log "PURGE state: keep ${KEEP_STATE_DAYS} days"
find "$STATE_DIR" -type f \( -name 'state-*.json' -o -name 'state-*.json.gz' \) \
  -mtime "+${KEEP_STATE_DAYS}" -print -delete >>"$BACKUP_LOG" 2>&1 || true

log "PURGE mysql: keep ${KEEP_MYSQL_DAYS} days"
find "$MYSQL_DIR" -type f \( -name 'mysql-*.sql' -o -name 'mysql-*.sql.gz' \) \
  -mtime "+${KEEP_MYSQL_DAYS}" -print -delete >>"$BACKUP_LOG" 2>&1 || true

# 5. 사용량 로그
STATE_COUNT=$(find "$STATE_DIR" -type f 2>/dev/null | wc -l)
MYSQL_COUNT=$(find "$MYSQL_DIR" -type f 2>/dev/null | wc -l)
TOTAL_MB=$(du -sm "$BACKUP_DIR" 2>/dev/null | awk '{print $1}' || echo 0)
log "DONE backup summary: state_files=${STATE_COUNT} mysql_files=${MYSQL_COUNT} total=${TOTAL_MB}MB"
