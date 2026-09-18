#!/usr/bin/env bash
# ============================================================================
# DIN Studio v6 — EC2 라이브 서버 모니터링 대시보드
# ============================================================================
# 용도: SSH에서 EC2에 붙어서 2초마다 갱신되는 라이브 상태판 보기 (운영자용)
#
# 사용법 (EC2 ubuntu 쉘에서):
#
#   [A] 인터랙티브 라이브 모니터링 (기본, 2초마다 갱신, 핫키 동작)
#       cd ~/youtube && bash deploy/ec2-live-monitor.sh
#
#   [B] 1회성 덤프 (cron / Slack 알림용 텍스트 출력, ANSI 없이)
#       MODE=once NO_COLOR=1 bash deploy/ec2-live-monitor.sh
#
#   [C] 갱신 주기 변경, 포트/앱 이름 변경 (기본값과 다를 때)
#       REFRESH_SEC=3 PM2_APP=toona PORT=3001 bash deploy/ec2-live-monitor.sh
#
# 라이브 모드 핫키:
#   w   → 워치독 즉시 1회 실행 (디스크 정리 + 헬스 복구 체인)
#   d   → 풀 디스크 리포트 (deploy/ec2-disk-report.sh) 실행 후 다시 대시보드
#   l   → pm2 logs youtube 최근 60줄 (에러+일반) 풀스크린 확인
#   t   → /api/state/storage-health 체크 + KV 레이턴시
#   h   → 헬프 (핫키 리스트)
#   r   → 즉시 화면 새로고침 (기본 2초 주기보다 빨리)
#   q   → 대시보드 종료 (Ctrl+C 도 동일)
# ============================================================================
set -uo pipefail
trap 'cleanup_exit' EXIT INT TERM

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ---------- 환경변수 기본값 ----------
PM2_APP="${PM2_APP:-youtube}"
PORT="${PORT:-3000}"
HEALTH_PORT="${PORT}"
REFRESH_SEC="${REFRESH_SEC:-2}"
MODE="${MODE:-live}"           # live | once
NO_COLOR="${NO_COLOR:-0}"
WATCHDOG_LOG="${WATCHDOG_LOG:-/var/log/youtube-watchdog.log}"
PM2_ERRLOG="${HOME}/.pm2/logs/${PM2_APP}-error.log"
PM2_OUTLOG="${HOME}/.pm2/logs/${PM2_APP}-out.log"
STORAGE_HEALTH_URL="http://127.0.0.1:${PORT}/api/state/storage-health"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
HEALTH_DEEP_URL="http://127.0.0.1:${PORT}/api/health?deep=1"
CURL_MAX="${CURL_MAX_SEC:-4}"

# ---------- 헬퍼 ----------
run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"
  else command sudo -n "$@" 2>/dev/null || "$@"; fi
}

# ---------- ANSI 컬러 지원 체크 ----------
TERM_CAP="$( (command -v tput >/dev/null 2>&1 && tput colors 2>/dev/null) || echo 0 )"
if [[ "${NO_COLOR}" == "1" || "${TERM_CAP:-0}" -lt 8 || ! -t 1 ]]; then
  RED="" GRN="" YLW="" BLU="" CYN="" WHT="" BLD="" RST="" CLR="" CUP=""
else
  RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'
  CYN=$'\033[36m'; WHT=$'\033[37m'; BLD=$'\033[1m';  RST=$'\033[0m'
  CLR=$'\033[2J';    CUP=$'\033[H'
fi

cleanup_exit() {
  local ec=$?
  [[ -n "${RST}" ]] && printf '%b' "${RST}"
  stty echo 2>/dev/null || true
  exit ${ec}
}

color_pct() {
  # $1 = 숫자 퍼센트. 85+ 빨강 / 70+ 노랑 / else 초록
  local v=$1
  if   [[ "$v" =~ ^[0-9]+$ ]] && [[ "$v" -ge 85 ]]; then printf '%b' "${RED}"
  elif [[ "$v" =~ ^[0-9]+$ ]] && [[ "$v" -ge 70 ]]; then printf '%b' "${YLW}"
  else  printf '%b' "${GRN}"
  fi
}

color_bool() {
  if [[ "$1" == "1" || "$1" == "ok" || "$1" == "true" ]]; then printf '%bOK' "${GRN}"
  else printf '%bFAIL' "${RED}"; fi
}

bar_pct() {
  # 10칸짜리 text bar. $1 = 퍼센트
  local p=$1 filled=0 i
  filled=$(( (p * 10 + 50) / 100 ))
  [[ "$filled" -gt 10 ]] && filled=10
  printf '['
  for ((i=0; i<filled; i++)); do printf '#'; done
  for ((i=filled; i<10; i++)); do printf ' '; done
  printf ']'
}

# ---------- 센서 수집 함수 ----------
collect_header() {
  HOSTNAME_S="$(hostname 2>/dev/null || echo unknown)"
  KERNEL_S="$(uname -sr 2>/dev/null || echo '-')"
  NOW_S="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  UPTIME_S="$( (command -v uptime >/dev/null && uptime -p 2>/dev/null) || (uptime 2>/dev/null | awk -F'up ' '{print $2}' | awk -F',' '{print $1}') || echo '-' )"
  LOAD_S="$(awk '{print $1, $2, $3}' /proc/loadavg 2>/dev/null || echo '- - -')"
  CORES_S="$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1)"
}

collect_system() {
  # CPU (1초 스냅샷)
  local line
  CPU_PCT="-"
  if [[ -r /proc/stat ]]; then
    read -r _ u n s i iow irq sirq _ < /proc/stat
    local total1=$((u+n+s+i+iow+irq+sirq))
    local idle1=$i
    sleep 0.5
    read -r u n s i iow irq sirq _ < /proc/stat
    local total2=$((u+n+s+i+iow+irq+sirq))
    local idle2=$i
    local dt=$((total2-total1))
    local di=$((idle2-idle1))
    if [[ "$dt" -gt 0 ]]; then
      CPU_PCT=$(( 100 - (di*100 + dt/2)/dt ))
    fi
  fi

  # RAM
  RAM_TOTAL_MB="-"; RAM_USED_MB="-"; RAM_PCT=0; SWAP_TOTAL_MB="-"; SWAP_USED_MB="-"; SWAP_PCT=0
  while IFS=':' read -r k v; do
    k="${k//[[:space:]]/}"
    case "$k" in
      MemTotal)  RAM_TOTAL_MB=$(( ${v// kB/} / 1024 )) ;;
      MemAvailable) RAM_AVAIL_MB=$(( ${v// kB/} / 1024 )) ;;
      SwapTotal) SWAP_TOTAL_MB=$(( ${v// kB/} / 1024 )) ;;
      SwapFree)  SWAP_FREE_MB=$(( ${v// kB/} / 1024 )) ;;
    esac
  done < /proc/meminfo 2>/dev/null
  if [[ -n "${RAM_TOTAL_MB:-}" && -n "${RAM_AVAIL_MB:-}" && "$RAM_TOTAL_MB" -gt 0 ]]; then
    RAM_USED_MB=$(( RAM_TOTAL_MB - RAM_AVAIL_MB ))
    RAM_PCT=$(( RAM_USED_MB * 100 / RAM_TOTAL_MB ))
  fi
  if [[ -n "${SWAP_TOTAL_MB:-}" && -n "${SWAP_FREE_MB:-}" && "$SWAP_TOTAL_MB" -gt 0 ]]; then
    SWAP_USED_MB=$(( SWAP_TOTAL_MB - SWAP_FREE_MB ))
    SWAP_PCT=$(( SWAP_USED_MB * 100 / SWAP_TOTAL_MB ))
  fi

  # DISK
  read -r DISK_PCT DISK_AVAIL_MB DISK_USE_KB DISK_TOTAL_KB < <(
    df -Pk / 2>/dev/null | awk 'NR==2 { gsub(/%/,"",$5); print $5, int($4/1024), $3, $2 }'
  )
  [[ -z "${DISK_PCT:-}" ]] && DISK_PCT=0
  DISK_TOTAL_MB=$(( DISK_TOTAL_KB / 1024 ))
  DISK_USED_MB=$(( DISK_USE_KB / 1024 ))
}

collect_processes() {
  # nginx
  NGINX_PID="-"; NGINX_STATUS="STOP"; NGINX_MEM_MB="-"
  if pidof nginx >/dev/null 2>&1; then
    NGINX_PID="$(pidof -s nginx 2>/dev/null || pgrep -xo nginx 2>/dev/null || echo '-')"
    NGINX_STATUS="RUN"
  elif systemctl list-unit-files nginx.service >/dev/null 2>&1; then
    systemctl is-active --quiet nginx 2>/dev/null && NGINX_STATUS="RUN"
  fi
  if [[ "${NGINX_PID}" != "-" ]]; then
    NGINX_MEM_MB="$( (ps -o rss= -p "${NGINX_PID}" 2>/dev/null || echo 0) | awk '{s+=$1} END {print int(s/1024)}' )"
  fi

  # MySQL
  MYSQL_PID="-"; MYSQL_STATUS="STOP"; MYSQL_MEM_MB="-"
  if pidof mysqld >/dev/null 2>&1; then
    MYSQL_PID="$(pidof -s mysqld 2>/dev/null || pgrep -xo mysqld 2>/dev/null || echo '-')"
    MYSQL_STATUS="RUN"
  elif systemctl list-unit-files mysql.service >/dev/null 2>&1; then
    systemctl is-active --quiet mysql 2>/dev/null && MYSQL_STATUS="RUN"
  fi
  if [[ "${MYSQL_PID}" != "-" ]]; then
    MYSQL_MEM_MB="$( (ps -o rss= -p "${MYSQL_PID}" 2>/dev/null || echo 0) | awk '{s+=$1} END {print int(s/1024)}' )"
  fi

  # PM2 app
  PM2_PID="-"; PM2_STATUS="STOP"; PM2_RESTARTS="-"; PM2_UPTIME="-"; PM2_MEM_MB="-"; PM2_HEAP_MB="-"
  if command -v pm2 >/dev/null 2>&1; then
    local desc
    desc="$(pm2 describe "${PM2_APP}" 2>/dev/null || true)"
    if [[ -n "$desc" ]]; then
      local pid stat restart uptime mem heap
      pid=$(echo "$desc"       | awk -F':' '/pid[[:space:]]*\|/     {gsub(/ /,"",$2); print $2; exit}')
      stat=$(echo "$desc"      | awk -F'│' '/status[[:space:]]*│/    {gsub(/ /,"",$3); print $3; exit}')
      restart=$(echo "$desc"   | awk -F'│' '/restart time[[:space:]]*│/ {gsub(/ /,"",$3); print $3; exit}')
      uptime=$(echo "$desc"    | awk -F'│' '/uptime[[:space:]]*│/    {gsub(/^ /,"",$3); sub(/ *$/,"",$3); print $3; exit}')
      mem=$(echo "$desc"       | awk -F'│' '/memory[[:space:]]*│/    {gsub(/ /,"",$3); gsub(/MB/,"",$3); print int($3); exit}')
      heap=$(echo "$desc"      | awk -F'│' '/heap size[[:space:]]*│/   {gsub(/ /,"",$3); gsub(/MB/,"",$3); print int($3); exit}')
      [[ -n "${pid:-}"     ]] && PM2_PID="$pid"
      [[ -n "${stat:-}"    ]] && PM2_STATUS="$stat"
      [[ -n "${restart:-}" ]] && PM2_RESTARTS="$restart"
      [[ -n "${uptime:-}"  ]] && PM2_UPTIME="$uptime"
      [[ -n "${mem:-}"     ]] && PM2_MEM_MB="$mem"
      [[ -n "${heap:-}"    ]] && PM2_HEAP_MB="$heap"
    fi
  fi
}

collect_health() {
  local t0 t1 dt_ms http_out deep_out
  HEALTH_OK=0; HEALTH_CODE="000"; HEALTH_MS="-"
  if command -v curl >/dev/null 2>&1; then
    t0=$(date +%s%3N)
    http_out="$(curl -sS -o /dev/null -w "%{http_code}" --max-time "$CURL_MAX_SEC" "$HEALTH_URL" 2>/dev/null || echo 000)"
    t1=$(date +%s%3N)
    dt_ms=$(( t1 - t0 ))
    HEALTH_CODE="${http_out:-000}"
    [[ "$HEALTH_CODE" == "200" ]] && HEALTH_OK=1
    HEALTH_MS="${dt_ms}ms"
  else
    # wget fallback
    if command -v wget >/dev/null 2>&1; then
      t0=$(date +%s)
      if wget -q --spider --timeout="$CURL_MAX_SEC" "$HEALTH_URL" 2>/dev/null; then
        HEALTH_OK=1; HEALTH_CODE="200"
      fi
      t1=$(date +%s); HEALTH_MS="$(( (t1-t0)*1000 ))ms"
    fi
  fi

  # deep health (KV·MySQL·Redis 상태) — 실패해도 메인 헬스 상태는 오버라이드하지 않음
  DEEP_OK="n/a"; KV_OK="n/a"; MYSQL_OK="n/a"; REDIS_OK="n/a"; KV_ERR=""
  if command -v curl >/dev/null 2>&1; then
    deep_out="$(curl -sf --max-time "$CURL_MAX_SEC" "$HEALTH_DEEP_URL" 2>/dev/null || true)"
    if [[ -n "$deep_out" ]]; then
      DEEP_OK=$(echo "$deep_out"    | grep -oE '"ok":[a-z]+'        | head -1 | cut -d: -f2)
      KV_OK=$(echo "$deep_out"      | grep -oE '"kvConfigured":[a-z]+' | head -1 | cut -d: -f2)
      MYSQL_OK=$(echo "$deep_out"   | grep -oE '"mysqlOk":[a-z]+'   | head -1 | cut -d: -f2)
      REDIS_OK=$(echo "$deep_out"   | grep -oE '"redisOk":[a-z]+'   | head -1 | cut -d: -f2)
      KV_ERR=$(echo "$deep_out"     | grep -oE '"kvError":"[^"]*"'  | head -1 | cut -d'"' -f4)
    fi
  fi
  [[ -z "${DEEP_OK}"  ]] && DEEP_OK="n/a"
  [[ -z "${KV_OK}"    ]] && KV_OK="n/a"
  [[ -z "${MYSQL_OK}" ]] && MYSQL_OK="n/a"
  [[ -z "${REDIS_OK}" ]] && REDIS_OK="n/a"
}

collect_watchdog() {
  WD_LAST_TS="-"; WD_LAST_ACTION="-"; WD_LAST_LINES=()
  if [[ -f "$WATCHDOG_LOG" ]]; then
    WD_LAST_LINES=( $(tail -n 3 "$WATCHDOG_LOG" 2>/dev/null || true) )
    local last_line
    last_line="$(tail -n 1 "$WATCHDOG_LOG" 2>/dev/null || true)"
    WD_LAST_TS="$(echo "$last_line" | grep -oE '\[[^]]+\]' | head -1 | tr -d '[]' )"
    WD_LAST_ACTION="$(echo "$last_line" | sed -E 's/^\[[^]]+\] //' )"
    [[ -z "$WD_LAST_TS" ]] && WD_LAST_TS="-"
    [[ -z "$WD_LAST_ACTION" || "${#WD_LAST_ACTION}" -gt 100 ]] && WD_LAST_ACTION="${WD_LAST_ACTION:0:100}"
  fi

  # watchdog cron 설치 여부
  WD_CRON_INSTALLED="-"
  if [[ -f /etc/cron.d/youtube-watchdog ]] || (crontab -l 2>/dev/null | grep -q 'youtube-watchdog'); then
    WD_CRON_INSTALLED="ON"
  fi
}

collect_log_snippet() {
  PM2_ERR_LAST3=()
  PM2_OUT_LAST3=()
  if [[ -f "$PM2_ERRLOG" ]]; then
    while IFS= read -r line; do PM2_ERR_LAST3+=("$line"); done < <(tail -n 3 "$PM2_ERRLOG" 2>/dev/null)
  fi
  if [[ -f "$PM2_OUTLOG" ]]; then
    while IFS= read -r line; do PM2_OUT_LAST3+=("$line"); done < <(grep -ivE '^\s*$' "$PM2_OUTLOG" 2>/dev/null | tail -n 3)
  fi
}

# ---------- 렌더링 ----------
render_dashboard() {
  collect_header
  collect_system
  collect_processes
  collect_health
  collect_watchdog
  collect_log_snippet

  local sep bar title wd_action_short
  sep="──────────────────────────────────────────────────────────────────────────────────────────"
  bar='──────────────────────────────────────'

  printf '%b%b' "${CLR}" "${CUP}"
  printf '%b%s DIN Studio v6 · EC2 LIVE MONITOR %s  [Mode: %s] [Refresh: %ss]\n' \
    "${BLD}${CYN}" "${sep:0:30}" "${sep:0:24}" "${MODE}" "${REFRESH_SEC}"
  printf '%b Host: %-18s Kernel: %-18s Uptime: %s\n'    "${RST}" "${HOSTNAME_S}" "${KERNEL_S}" "${UPTIME_S}"
  printf ' Now : %-26s LoadAvg: %-18s Cores: %s\n'        "${NOW_S}" "${LOAD_S}" "${CORES_S}"
  printf '%s\n' "$sep"

  # ===== 섹션 1. 시스템 리소스 =====
  printf '%b[ SYSTEM RESOURCE ]%b\n' "${BLD}${BLU}" "${RST}"
  printf '  CPU   : %b%s %3d%% %b' "$(color_pct "$CPU_PCT")" "$(bar_pct "${CPU_PCT:-0}")" "${CPU_PCT:-0}" "${RST}"
  printf '    RAM   : %b%s %3d%% %b  (%d / %d MB)\n' "$(color_pct "$RAM_PCT")" "$(bar_pct "$RAM_PCT")" "$RAM_PCT" "${RST}" "${RAM_USED_MB:-0}" "${RAM_TOTAL_MB:-0}"
  printf '  DISK  : %b%s %3d%% %b' "$(color_pct "$DISK_PCT")" "$(bar_pct "$DISK_PCT")" "${DISK_PCT}" "${RST}"
  printf '    SWAP  : %b%s %3d%% %b  (%d / %d MB)\n' "$(color_pct "$SWAP_PCT")" "$(bar_pct "$SWAP_PCT")" "$SWAP_PCT" "${RST}" "${SWAP_USED_MB:-0}" "${SWAP_TOTAL_MB:-0}"
  printf '  Free Disk: %d / %d MB  (%s available)\n' "${DISK_AVAIL_MB:-0}" "${DISK_TOTAL_MB:-0}" "${DISK_AVAIL_MB:+$(numfmt --to=iec --suffix=B "$((DISK_AVAIL_MB*1024*1024))" 2>/dev/null || echo "${DISK_AVAIL_MB}MB")}"
  printf '%s\n' "$bar"

  # ===== 섹션 2. 프로세스 =====
  printf '%b[ PROCESSES ]%b\n' "${BLD}${BLU}" "${RST}"
  printf '  %-8s %-8s %-8s %-10s %-12s %s\n' "NAME" "STATUS" "PID" "MEM_MB" "RESTARTS" "UPTIME"
  local col
  col="$GRN"; [[ "$NGINX_STATUS" != "RUN" ]] && col="$RED"
  printf '  %-8s %b%-8s%b %-8s %-10s %-12s %s\n' "nginx"  "${col}" "${NGINX_STATUS}" "${RST}" "${NGINX_PID}" "${NGINX_MEM_MB}" "-" "-"
  col="$GRN"; [[ "$MYSQL_STATUS" != "RUN" ]] && col="$RED"
  printf '  %-8s %b%-8s%b %-8s %-10s %-12s %s\n' "mysql"  "${col}" "${MYSQL_STATUS}" "${RST}" "${MYSQL_PID}" "${MYSQL_MEM_MB}" "-" "-"
  col="$GRN"; [[ "$PM2_STATUS" != "online" && "$PM2_STATUS" != "RUN" ]] && col="$YLW"
  [[ "$PM2_STATUS" == "STOP" || -z "$PM2_STATUS" || "$PM2_STATUS" == "errored" ]] && col="$RED"
  printf '  %-8s %b%-8s%b %-8s %-10s %-12s %s\n' "pm2:${PM2_APP}" "${col}" "${PM2_STATUS}" "${RST}" "${PM2_PID}" "${PM2_MEM_MB}${PM2_HEAP_MB:+/heap${PM2_HEAP_MB}}" "${PM2_RESTARTS}" "${PM2_UPTIME}"
  printf '%s\n' "$bar"

  # ===== 섹션 3. 앱 헬스 / 스토리지 =====
  printf '%b[ APP HEALTH & STORAGE ]%b\n' "${BLD}${BLU}" "${RST}"
  local hcol
  hcol="$GRN"; [[ "$HEALTH_OK" != "1" ]] && hcol="$RED"
  printf '  HTTP /api/health        : %bHTTP %s  %b  latency %-7s  (port %s)\n' "${hcol}" "${HEALTH_CODE}" "${RST}" "${HEALTH_MS}" "${PORT}"
  printf '  DEEP ?deep=1 (ok:%s)    KVcfg=%s  Redis=%s  MySQL=%s\n' "${DEEP_OK}" "${KV_OK}" "${REDIS_OK}" "${MYSQL_OK}"
  if [[ -n "$KV_ERR" ]]; then
    printf '  KV Error                : %b%s%b\n' "${RED}" "${KV_ERR}" "${RST}"
  fi
  printf '%s\n' "$bar"

  # ===== 섹션 4. 워치독 =====
  wd_action_short="${WD_LAST_ACTION:0:96}"
  printf '%b[ WATCHDOG ]%b  cron=%s  log=%s\n' "${BLD}${BLU}" "${RST}" "$WD_CRON_INSTALLED" "$WATCHDOG_LOG"
  printf '  Last Run    : %s\n' "${WD_LAST_TS}"
  printf '  Last Action : %s\n' "${wd_action_short:--}"
  if [[ "${#WD_LAST_LINES[@]}" -gt 0 ]]; then
    printf '  Last 3 lines:\n'
    local l
    for l in "${WD_LAST_LINES[@]:0:3}"; do
      printf '    · %s\n' "${l:0:100}"
    done
  fi
  printf '%s\n' "$bar"

  # ===== 섹션 5. 로그 스니펫 =====
  printf '%b[ RECENT LOGS ]%b\n' "${BLD}${BLU}" "${RST}"
  local line
  if [[ "${#PM2_ERR_LAST3[@]}" -gt 0 ]]; then
    printf '  pm2:%s-error.log (최근 3)\n' "${PM2_APP}"
    for line in "${PM2_ERR_LAST3[@]}"; do
      printf '%b    ! %s%b\n' "${RED}" "${line:0:100}" "${RST}"
    done
  else
    printf '  pm2:%s-error.log : (파일 없거나 비어있음)\n' "${PM2_APP}"
  fi
  if [[ "${#PM2_OUT_LAST3[@]}" -gt 0 ]]; then
    printf '  pm2:%s-out.log   (최근 3)\n' "${PM2_APP}"
    for line in "${PM2_OUT_LAST3[@]}"; do
      printf '    · %s\n' "${line:0:100}"
    done
  fi
  printf '%s\n' "$sep"

  # ===== 핫키 가이드 =====
  printf '%b[HOTKEY]%b w=워치독즉시실행  d=디스크상세  l=pm2 logs 60줄  t=storage-health  h=헬프  r=새로고침  q=종료\n' \
    "${BLD}${GRN}" "${RST}"
}

run_watchdog_oneshot() {
  echo ""
  echo "▶ Watchdog 1회 실행 ..."
  if [[ -x deploy/ec2-watchdog.sh ]]; then
    bash deploy/ec2-watchdog.sh 2>&1 | tail -n 40 || true
  else
    run bash deploy/ec2-watchdog.sh 2>&1 | tail -n 40 || true
  fi
  echo "↩ 3초 후 대시보드로 복귀합니다 ..."
  sleep 3
}

run_disk_report() {
  echo ""
  echo "▶ 풀 디스크 리포트 ..."
  bash deploy/ec2-disk-report.sh 2>&1 || true
  echo ""
  read -rsn 1 -p $'\033[36m아무 키나 누르면 대시보드로 돌아갑니다...\033[0m' _
}

run_pm2_logs() {
  echo ""
  if command -v pm2 >/dev/null 2>&1; then
    pm2 logs "${PM2_APP}" --nostream --lines 60 2>&1 | ${PAGER:-cat} || true
  else
    echo "pm2 커맨드가 없습니다. 다음 로그 파일을 직접 여세요:"
    echo "  $PM2_ERRLOG"
    echo "  $PM2_OUTLOG"
  fi
  echo ""
  read -rsn 1 -p $'\033[36m아무 키나 누르면 대시보드로 돌아갑니다...\033[0m' _
}

run_storage_health() {
  echo ""
  echo "▶ /api/state/storage-health 체크 ..."
  if command -v curl >/dev/null 2>&1; then
    curl -sf --max-time 6 "$STORAGE_HEALTH_URL" 2>/dev/null | (command -v jq >/dev/null 2>&1 && jq . || cat) || echo "  FAIL: curl 반환 없음 (앱이 죽었을 수 있음)"
  else
    wget -qO- --timeout=6 "$STORAGE_HEALTH_URL" 2>/dev/null || echo "  FAIL: wget 반환 없음"
  fi
  echo ""
  read -rsn 1 -p $'\033[36m아무 키나 누르면 대시보드로 돌아갑니다...\033[0m' _
}

show_help() {
  cat <<'EOF'

DIN Studio v6 LIVE MONITOR — 핫키 도움말
────────────────────────────────────────
  [w]  워치독 1회 즉시 실행
       → 디스크 85%+ 정리 · health 실패시 recover 체인
  [d]  풀 디스크 리포트 (ec2-disk-report.sh)
       → 큰 파일 20개 · /var/lib/mysql · .next · node_modules 용량
  [l]  PM2 앱 로그 최근 60줄
       → 에러/일반 로그 함께 확인
  [t]  /api/state/storage-health 체크
       → KV 레이턴시 · MySQL · Redis 저장소 상태
  [h]  이 도움말
  [r]  즉시 새로고침 (REFRESH_SEC 주기보다 빠름)
  [q]  종료 (Ctrl+C 도 동일)

자동 백그라운드 모니터링: cron watchdog (5분 주기)
  설치: bash deploy/ec2-setup-watchdog.sh
  로그: tail -n 50 /var/log/youtube-watchdog.log

────────────────────────────────────────
EOF
  read -rsn 1 -p $'\033[36m아무 키나 누르면 대시보드로 돌아갑니다...\033[0m' _
}

# ---------- 메인 루프 ----------
if [[ "${MODE}" == "once" ]]; then
  NO_COLOR=1
  render_dashboard
  exit 0
fi

# 라이브 모드: 입력 넌블로킹 + 주기 렌더
stty -echo 2>/dev/null || true
NEXT_TICK=0
LAST_INPUT=""
while true; do
  NOW_TICK=$(date +%s)

  # 렌더 타이밍
  if [[ "$NOW_TICK" -ge "$NEXT_TICK" ]]; then
    render_dashboard
    NEXT_TICK=$(( NOW_TICK + REFRESH_SEC ))
  fi

  # 넌블로킹 입력 읽기 (0.2초 타임아웃)
  LAST_INPUT=""
  if read -rsn 1 -t 0.2 LAST_INPUT 2>/dev/null; then
    case "${LAST_INPUT}" in
      w|W) run_watchdog_oneshot ;;
      d|D) run_disk_report ;;
      l|L) run_pm2_logs ;;
      t|T) run_storage_health ;;
      h|H|?) show_help ;;
      r|R) NEXT_TICK=0 ;;
      q|Q) echo ""; echo "종료합니다."; exit 0 ;;
      *) ;;
    esac
  fi
done
