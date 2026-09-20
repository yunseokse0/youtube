#!/usr/bin/env bash
# EC2 런타임 워치독 — 디스크 임계값 자동 정리 + MySQL/pm2 헬스 복구
# cron에서 5분마다 실행 (deploy/ec2-setup-watchdog.sh)
#
# · 디스크 ≥85%: MODE=daily 로그 정리
# · 디스크 ≥92%: MODE=manual (빌드 캐시·apt 캐시 등 추가)
# · /api/health 실패: ec2-recover-youtube (15분 쿨다운)
# · MySQL stopped: systemctl start
# · OOM Killer node 프로세스 감지 → pm2 restart + 알람
# · 임계치 이벤트 → ALARM_WEBHOOK_URL (Telegram/Slack 등) 1회 POST
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
ALARM_STAMP="${ALARM_STAMP:-/var/run/youtube-alarm-last.ts}"
ALARM_COOLDOWN_SEC="${ALARM_COOLDOWN_SEC:-300}"
ALARM_WEBHOOK_URL="${ALARM_WEBHOOK_URL:-}"

HOST_TAG="${HOST_TAG:-EC2}"
ALARM_SEVERITY="${ALARM_SEVERITY:-CRIT}"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

append_log() {
  log "$*" >>"$LOG_FILE" 2>/dev/null || log "$*"
}

send_alarm() {
  local level="$1"; shift
  local msg="$*"
  local now last_alg
  now="$(date +%s)"
  last_alg=0
  [[ -f "$ALARM_STAMP" ]] && last_alg="$(cat "$ALARM_STAMP" 2>/dev/null || echo 0)"
  if [[ "$((now - last_alg))" -lt "$ALARM_COOLDOWN_SEC" ]]; then
    append_log "alarm throttle ($((ALARM_COOLDOWN_SEC - (now - last_alg)))s left): [${level}] ${msg}"
    return 0
  fi
  append_log "ALARM [${level}] ${msg}"
  echo "$now" | run tee "$ALARM_STAMP" >/dev/null 2>&1 || echo "$now" >"$ALARM_STAMP" 2>/dev/null || true
  if [[ -z "${ALARM_WEBHOOK_URL}" ]]; then
    return 0
  fi
  local payload
  payload="[$(date '+%Y-%m-%d %H:%M:%S')] ${HOST_TAG}/${ALARM_SEVERITY}/${level}: ${msg}"
  # Telegram format
  if [[ "${ALARM_WEBHOOK_URL}" == *"api.telegram.org"* ]]; then
    curl -sf --max-time 10 -X POST "${ALARM_WEBHOOK_URL}" \
      -H "Content-Type: application/json" \
      -d "$(printf '{"text":%s, "disable_web_page_preview":true}' "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${payload}")")" \
      >/dev/null 2>&1 || append_log "alarm telegram post FAIL"
  else
    # Slack / Discord / generic JSON
    local json_text
    json_text="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${payload}")"
    curl -sf --max-time 10 -X POST "${ALARM_WEBHOOK_URL}" \
      -H "Content-Type: application/json" \
      -d "{\"text\":${json_text},\"content\":${json_text}}" \
      >/dev/null 2>&1 || append_log "alarm webhook post FAIL"
  fi
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
  send_alarm "DISK_CRIT" "disk=${PCT}% (free ${AVAIL}MB, threshold=${DISK_CRIT_PCT}%) — executing manual disk clean"
  MODE=manual HOME="${HOME:-/home/ubuntu}" bash "$ROOT/deploy/ec2-free-disk.sh" >>"$LOG_FILE" 2>&1 || true
  ACTIONS+=("disk-manual")
  PCT="$(pct_used || echo "$PCT")"
  AVAIL="$(avail_mb || echo "$AVAIL")"
elif [[ "$PCT" =~ ^[0-9]+$ ]] && [[ "$PCT" -ge "$DISK_WARN_PCT" ]]; then
  append_log "WARN disk ${PCT}% (free ${AVAIL}MB) — daily disk clean"
  send_alarm "DISK_WARN" "disk=${PCT}% (free ${AVAIL}MB, threshold=${DISK_WARN_PCT}%) — executing daily disk clean"
  MODE=daily HOME="${HOME:-/home/ubuntu}" bash "$ROOT/deploy/ec2-free-disk.sh" >>"$LOG_FILE" 2>&1 || true
  ACTIONS+=("disk-daily")
  PCT="$(pct_used || echo "$PCT")"
  AVAIL="$(avail_mb || echo "$AVAIL")"
fi

if ! systemctl is-active mysql >/dev/null 2>&1; then
  append_log "MySQL inactive — systemctl start"
  send_alarm "MYSQL_DOWN" "MySQL service inactive — systemctl start"
  run systemctl start mysql 2>>"$LOG_FILE" || append_log "MySQL start failed"
  ACTIONS+=("mysql-start")
fi

HEALTH_OK=0
if curl -sf --max-time "$HEALTH_TIMEOUT_SEC" "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  HEALTH_OK=1
fi

NGINX_OK=0
if curl -sf --max-time 5 -o /dev/null "http://127.0.0.1/" 2>/dev/null; then
  NGINX_OK=1
fi
if [[ "$HEALTH_OK" == "1" ]] && [[ "$NGINX_OK" != "1" ]] && systemctl list-unit-files nginx.service >/dev/null 2>&1; then
  append_log "nginx :80 unreachable — systemctl start nginx"
  send_alarm "NGINX_DOWN" "nginx port 80 unreachable — systemctl start nginx (app health OK)"
  run systemctl start nginx 2>>"$LOG_FILE" || append_log "nginx start failed"
  ACTIONS+=("nginx-start")
fi

# OOM Killer: 최근 1시간 이내 dmesg 에서 node 프로세스 kill 이벤트 감지
OOM_KILL_TS="${WATCHDOG_OOM_STAMP:-/var/run/youtube-watchdog-oom.ts}"
LAST_OOM=0
[[ -f "$OOM_KILL_TS" ]] && LAST_OOM="$(cat "$OOM_KILL_TS" 2>/dev/null || echo 0)"
NOW="$(date +%s)"
# dmesg는 커널 링 버퍼라 오래된 기록은 없어질 수 있으니 tail -n 200 정도로 체크
OOM_LINE=""
OOM_LINE="$(dmesg -T 2>/dev/null | tail -n 200 | grep -iE 'Out of memory|Killed process' | grep -iE 'node|npm|next' | tail -n 1 || true)"
if [[ -n "${OOM_LINE}" ]] && [[ "$((NOW - LAST_OOM))" -ge "${ALARM_COOLDOWN_SEC}" ]]; then
  append_log "OOM KILL DETECTED → pm2 restart ${PM2_APP} (${OOM_LINE:0:120})"
  send_alarm "OOM_KILL" "Linux OOM Killer killed node/npm process. Auto restarting pm2 ${PM2_APP}. line=${OOM_LINE:0:120}"
  echo "$NOW" | run tee "$OOM_KILL_TS" >/dev/null 2>&1 || echo "$NOW" >"$OOM_KILL_TS" 2>/dev/null || true
  pm2 restart "$PM2_APP" 2>/dev/null >>"$LOG_FILE" 2>&1 || append_log "OOM pm2 restart FAIL"
  ACTIONS+=("oom-restart")
fi

if [[ "$HEALTH_OK" != "1" ]]; then
  LAST=0
  [[ -f "$RECOVER_STAMP" ]] && LAST="$(cat "$RECOVER_STAMP" 2>/dev/null || echo 0)"
  if [[ "$((NOW - LAST))" -ge "$RECOVER_COOLDOWN_SEC" ]]; then
    append_log "health FAIL (disk ${PCT}%, free ${AVAIL}MB) — ec2-recover-youtube"
    send_alarm "HEALTH_FAIL" "/api/health FAIL for ${HEALTH_TIMEOUT_SEC}s. disk=${PCT}% free=${AVAIL}MB. Running ec2-recover-youtube"
    echo "$NOW" | run tee "$RECOVER_STAMP" >/dev/null 2>&1 || echo "$NOW" >"$RECOVER_STAMP"
    if HOME="${HOME:-/home/ubuntu}" bash "$ROOT/deploy/ec2-recover-youtube.sh" >>"$LOG_FILE" 2>&1; then
      ACTIONS+=("recover-ok")
    else
      append_log "recover FAILED — pm2 logs ${PM2_APP} 확인"
      send_alarm "RECOVER_FAIL" "ec2-recover-youtube.sh FAILED. Check pm2 logs ${PM2_APP}"
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
