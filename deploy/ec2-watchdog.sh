#!/usr/bin/env bash
# EC2 런타임 워치독 — 디스크 임계값 자동 정리 + MySQL/pm2 헬스 복구
# cron에서 5분마다 실행 (deploy/ec2-setup-watchdog.sh)
#
# · 디스크 ≥85%: MODE=daily 로그 정리
# · 디스크 ≥92%: MODE=manual (빌드 캐시·apt 캐시 등 추가)
# · /api/health 실패: ec2-recover-youtube (15분 쿨다운)
# · MySQL stopped: systemctl start
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PM2_APP="${PM2_APP:-youtube}"
PORT="${PORT:-3000}"
DISK_WARN_PCT="${DISK_WARN_PCT:-85}"
DISK_CRIT_PCT="${DISK_CRIT_PCT:-92}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-8}"
RECOVER_COOLDOWN_SEC="${RECOVER_COOLDOWN_SEC:-900}"
LOG_FILE="${WATCHDOG_LOG:-/var/log/youtube-watchdog.log}"
RECOVER_STAMP="${WATCHDOG_RECOVER_STAMP:-/var/run/youtube-watchdog-recover.ts}"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

append_log() {
  log "$*" >>"$LOG_FILE" 2>/dev/null || log "$*"
}

pct_used() {
  df -Pk / | awk 'NR==2 {gsub(/%/,"",$5); print $5}'
}

avail_mb() {
  df -Pk / | awk 'NR==2 {print int($4/1024)}'
}

truncate_watchdog_log_if_huge() {
  if [[ -f "$LOG_FILE" ]]; then
    run find "$LOG_FILE" -size +8M -exec truncate -s 0 {} \; 2>/dev/null || true
  fi
}

truncate_watchdog_log_if_huge
touch "$LOG_FILE" 2>/dev/null || LOG_FILE="$HOME/youtube-watchdog.log"
touch "$LOG_FILE" 2>/dev/null || true

PCT="$(pct_used || echo 0)"
AVAIL="$(avail_mb || echo 0)"
ACTIONS=()

if [[ "$PCT" =~ ^[0-9]+$ ]] && [[ "$PCT" -ge "$DISK_CRIT_PCT" ]]; then
  append_log "CRIT disk ${PCT}% (free ${AVAIL}MB) — manual disk clean"
  MODE=manual HOME="${HOME:-/home/ubuntu}" bash "$ROOT/deploy/ec2-free-disk.sh" >>"$LOG_FILE" 2>&1 || true
  ACTIONS+=("disk-manual")
  PCT="$(pct_used || echo "$PCT")"
  AVAIL="$(avail_mb || echo "$AVAIL")"
elif [[ "$PCT" =~ ^[0-9]+$ ]] && [[ "$PCT" -ge "$DISK_WARN_PCT" ]]; then
  append_log "WARN disk ${PCT}% (free ${AVAIL}MB) — daily disk clean"
  MODE=daily HOME="${HOME:-/home/ubuntu}" bash "$ROOT/deploy/ec2-free-disk.sh" >>"$LOG_FILE" 2>&1 || true
  ACTIONS+=("disk-daily")
  PCT="$(pct_used || echo "$PCT")"
  AVAIL="$(avail_mb || echo "$AVAIL")"
fi

if ! systemctl is-active mysql >/dev/null 2>&1; then
  append_log "MySQL inactive — systemctl start"
  run systemctl start mysql 2>>"$LOG_FILE" || append_log "MySQL start failed"
  ACTIONS+=("mysql-start")
fi

HEALTH_OK=0
if curl -sf --max-time "$HEALTH_TIMEOUT_SEC" "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  HEALTH_OK=1
fi

if [[ "$HEALTH_OK" != "1" ]]; then
  NOW="$(date +%s)"
  LAST=0
  [[ -f "$RECOVER_STAMP" ]] && LAST="$(cat "$RECOVER_STAMP" 2>/dev/null || echo 0)"
  if [[ "$((NOW - LAST))" -ge "$RECOVER_COOLDOWN_SEC" ]]; then
    append_log "health FAIL (disk ${PCT}%, free ${AVAIL}MB) — ec2-recover-youtube"
    echo "$NOW" | run tee "$RECOVER_STAMP" >/dev/null 2>&1 || echo "$NOW" >"$RECOVER_STAMP"
    if HOME="${HOME:-/home/ubuntu}" bash "$ROOT/deploy/ec2-recover-youtube.sh" >>"$LOG_FILE" 2>&1; then
      ACTIONS+=("recover-ok")
    else
      append_log "recover FAILED — pm2 logs ${PM2_APP} 확인"
      ACTIONS+=("recover-fail")
    fi
  else
    append_log "health FAIL — recover cooldown ($((RECOVER_COOLDOWN_SEC - (NOW - LAST)))s left)"
    ACTIONS+=("recover-cooldown")
  fi
else
  if [[ "${#ACTIONS[@]}" -gt 0 ]]; then
    append_log "health OK after: ${ACTIONS[*]} (disk ${PCT}%, free ${AVAIL}MB)"
  fi
fi

# 정상·조치 없을 때는 1시간에 한 번만 OK 로그 (로그 폭주 방지)
if [[ "$HEALTH_OK" == "1" ]] && [[ "${#ACTIONS[@]}" -eq 0 ]]; then
  STAMP_OK="${WATCHDOG_OK_STAMP:-/var/run/youtube-watchdog-ok.ts}"
  NOW="$(date +%s)"
  LAST_OK=0
  [[ -f "$STAMP_OK" ]] && LAST_OK="$(cat "$STAMP_OK" 2>/dev/null || echo 0)"
  if [[ "$((NOW - LAST_OK))" -ge 3600 ]]; then
    append_log "OK disk=${PCT}% free=${AVAIL}MB health=ok"
    echo "$NOW" | run tee "$STAMP_OK" >/dev/null 2>&1 || echo "$NOW" >"$STAMP_OK"
  fi
fi
