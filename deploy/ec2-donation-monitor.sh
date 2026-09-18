#!/usr/bin/env bash
# DIN Studio v6 · EC2 실시간 후원 모니터링 TUI (ec2-donation-monitor.sh)
#
# 사용법:
#   bash deploy/ec2-donation-monitor.sh            # 기본 대상 유저 finalent · 로컬 3000 포트
#   TARGET_USER=testuser123 PORT=4000 bash deploy/ec2-donation-monitor.sh
#   MODE=once NO_COLOR=1 bash deploy/ec2-donation-monitor.sh   # 1회 덤프 + 파이프 가능
#   COOKIE='sb_user=<value>; Path=/' TARGET_USER=finalent bash deploy/ec2-donation-monitor.sh
#
# 핫키 (TUI 모드):
#   [r]   즉시 새로고침
#   [h]   도움말 토글
#   [q]   종료
#
# 요구사항:
#   - curl, python3, bash 4+ (Ubuntu 22.04 기본 탑재)
#   - 현재 pm2 앱이 실행 중이어야 함 (기본 PORT=3000)
#   - 관리자 쿠키 COOKIE 환경변수를 넘기면 write 권한이 필요한 API 정상 호출 됨

set -u

APP_NAME="${APP_NAME:-youtube}"
PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
TARGET_USER="${TARGET_USER:-finalent}"
MODE="${MODE:-tui}"
REFRESH_MS="${REFRESH_MS:-2000}"
COOKIE="${COOKIE:-}"
NO_COLOR="${NO_COLOR:-0}"
MODE_ONCE=0
if [ "$MODE" = "once" ]; then MODE_ONCE=1; fi
if [ "$NO_COLOR" = "1" ]; then
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_MAGENTA=""; C_CYAN=""; C_DIM=""; C_RST="";
else
  C_RED=$'\e[31m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_BLUE=$'\e[34m'; C_MAGENTA=$'\e[35m'; C_CYAN=$'\e[36m'; C_DIM=$'\e[90m'; C_RST=$'\e[0m'
fi
BOLD=$'\e[1m'

TMP_DIR="$(mktemp -d 2>/dev/null || echo "/tmp/ec2-dm-$$")"
mkdir -p "$TMP_DIR" 2>/dev/null
trap 'rm -rf "$TMP_DIR"; printf "\033[?25h\033[0m"; stty echo 2>/dev/null' EXIT

PY=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || echo "")
if [ -z "$PY" ]; then
  echo "ERROR: python3 또는 python 이 필요합니다."
  exit 1
fi

curl_get() {
  local url="$1"
  if [ -n "$COOKIE" ]; then
    curl -s -m 8 --max-time 8 -b "$COOKIE" "$url" 2>/dev/null
  else
    curl -s -m 8 --max-time 8 "$url" 2>/dev/null
  fi
}

json_field_str() {
  local src="$1" expr="$2" def="${3:-}"
  if [ -z "$src" ]; then echo "$def"; return; fi
  "$PY" -c "
import json,sys
try:
  d=json.loads(sys.stdin.read() or '{}')
except Exception:
  print(sys.argv[2]); sys.exit(0)
try:
  v=eval(sys.argv[1].replace('/', '.'), {'__builtins__':{}}, {'d':d})
  if v is None: v=sys.argv[2]
  if isinstance(v,bool): v='true' if v else 'false'
  s=str(v).replace('\n',' ').replace('\r',' ').replace('\t',' ')
  print(s[:300])
except Exception:
  print(sys.argv[2])
" "$expr" "$def" <<< "$src"
}

fmt_ago() {
  local ms="$1" now
  now=$(date +%s%3N)
  if [ -z "$ms" ] || [ "$ms" = "null" ] || [ "$ms" = "0" ]; then echo "—"; return; fi
  if ! [[ "$ms" =~ ^[0-9]+$ ]]; then echo "—"; return; fi
  local diff=$(( (now - ms) / 1000 ))
  if [ $diff -lt 0 ]; then diff=0; fi
  if [ $diff -lt 60 ]; then echo "${diff}초 전"; return; fi
  if [ $diff -lt 3600 ]; then echo "$((diff/60))분 전"; return; fi
  if [ $diff -lt 86400 ]; then echo "$((diff/3600))시간 전"; return; fi
  echo "$((diff/86400))일 전"
}

fmt_krw() {
  local n="$1"
  if [ -z "$n" ] || [ "$n" = "null" ] || [ "$n" = "None" ]; then n=0; fi
  if ! [[ "$n" =~ ^-?[0-9]+$ ]]; then echo "₩$n"; return; fi
  "$PY" -c "
import sys
try: n=int(sys.argv[1])
except: n=0
print('₩'+'{:,}'.format(n))
" "$n"
}

safe_pad() {
  local pad="$1"
  [ -z "$pad" ] && pad=0
  if ! [[ "$pad" =~ ^-?[0-9]+$ ]]; then pad=0; fi
  if [ "$pad" -lt 0 ]; then pad=0; fi
  echo "$pad"
}

json_list_tail_donors() {
  local src="$1" expr="$2" limit="$3"
  if [ -z "$src" ]; then return; fi
  "$PY" -c "
import json,sys
try:
  d=json.loads(sys.stdin.read() or '{}')
except Exception:
  sys.exit(0)
try:
  arr=eval(sys.argv[1].replace('/','.'), {'__builtins__':{}}, {'d':d})
except Exception:
  sys.exit(0)
if not isinstance(arr,list): sys.exit(0)
limit=int(sys.argv[2])
rows=[]
for x in arr[-limit:]:
  if not isinstance(x,dict): continue
  at=str(x.get('at') or x.get('ingestedAt') or '')
  if at and at.endswith('Z'):
    try:
      import datetime
      dt=datetime.datetime.fromisoformat(at.replace('Z','+00:00'))
      dt_kr=dt.astimezone(datetime.timezone(datetime.timedelta(hours=9)))
      at=dt_kr.strftime('%m-%d %H:%M:%S')
    except Exception: pass
  elif at and len(at)>=19:
    at=at[5:10]+' '+at[11:19]
  name=str(x.get('donorName') or x.get('donor') or '?')[:14]
  amt=x.get('amount') or 0
  try: amt=int(amt)
  except: amt=0
  target=str(x.get('target') or '')
  target_short={'account':'계좌','toon':'툰','toonation':'투네','bank':'계좌'}.get(target, target[:4] if target else '')
  msg=str(x.get('message') or '')[:28].replace('\n',' ').replace('\r',' ')
  src_tag=''
  if x.get('provider')=='toonation' or x.get('source')=='ws': src_tag='WS'
  elif x.get('provider')=='bank' or x.get('source')=='ingest': src_tag='HB'
  elif x.get('source')=='toona': src_tag='HB'
  if src_tag: src_tag='['+src_tag+']'
  amt_s='₩'+'{:>10,}'.format(amt)
  rows.append(f'{at} {src_tag:<4} {name:<14} {amt_s} {target_short:<3} {msg}')
for r in reversed(rows): print(r)
" "$expr" "$limit" <<< "$src"
}

collect_snapshot() {
  local mode_url="${BASE_URL}/api/settings/intake-mode?u=${TARGET_USER}"
  local listener_url="${BASE_URL}/api/donations/toonation/listener?u=${TARGET_USER}"
  local hub_url="${BASE_URL}/api/toona/hub?u=${TARGET_USER}"
  local queue_url="${BASE_URL}/api/donations/queue?u=${TARGET_USER}"
  local unmatched_url="${BASE_URL}/api/donations/unmatched?u=${TARGET_USER}"
  local state_url="${BASE_URL}/api/state?u=${TARGET_USER}"
  local pm2_log_url="${BASE_URL}/api/health"

  SNAP_MODE_JSON="$(curl_get "$mode_url")"
  SNAP_WS_JSON="$(curl_get "$listener_url")"
  SNAP_HUB_JSON="$(curl_get "$hub_url")"
  SNAP_QUEUE_JSON="$(curl_get "$queue_url")"
  SNAP_UNMATCH_JSON="$(curl_get "$unmatched_url")"
  SNAP_STATE_JSON="$(curl_get "$state_url" | cut -c 1-500000)"
  SNAP_HEALTH_JSON="$(curl_get "$pm2_log_url")"
}

render_ui() {
  clear
  local cols
  cols=$(tput cols 2>/dev/null || echo 120)
  local lines
  lines=$(tput lines 2>/dev/null || echo 40)
  [ -z "$cols" ] && cols=120
  [ -z "$lines" ] && lines=40
  if [ "$cols" -lt 80 ]; then cols=80; fi
  if [ "$lines" -lt 20 ]; then lines=20; fi

  local hdr
  hdr="DIN 후원 실시간 모니터 · TARGET=${BOLD}${TARGET_USER}${C_RST} · ${BASE_URL}"
  local now
  now=$(date '+%Y-%m-%d %H:%M:%S %Z')

  local pad
  printf '\033[H'
  pad="$(safe_pad $((cols - 2)))"
  printf '%s%*s%s\n' "${BOLD}${C_CYAN}┌─${C_RST}" "$pad" "" "${BOLD}${C_CYAN}─┐${C_RST}"
  pad="$(safe_pad $(( cols - 12 - ${#now} )))"
  printf '%s%s %s%*s%s%s\n' "${C_CYAN}│${C_RST}" "$hdr" "${C_DIM}refresh every $((REFRESH_MS/1000))s · ${now}${C_RST}" "$pad" "" "${C_CYAN}│${C_RST}" | cut -c1-"$cols"
  pad="$(safe_pad $((cols - 2)))"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "$pad" "" "${C_CYAN}─┤${C_RST}"

  local mode_ok short mode_val applied desc runtime_mem
  mode_ok=$(json_field_str "$SNAP_MODE_JSON" 'd.get("ok")' '')
  mode_val=$(json_field_str "$SNAP_MODE_JSON" 'd.get("mode")' '—')
  short=$(json_field_str "$SNAP_MODE_JSON" 'd.get("short")' '')
  desc=$(json_field_str "$SNAP_MODE_JSON" 'd.get("description")' '')
  if [ "$mode_ok" = "true" ]; then
    if [ "$mode_val" = "A" ]; then
      mode_label="${C_BLUE}${BOLD}A 모드 · 투네 WS 직결${C_RST}"
    elif [ "$mode_val" = "B" ]; then
      mode_label="${C_MAGENTA}${BOLD}B 모드 · DIN 허브 폴러${C_RST}"
    else
      mode_label="${C_YELLOW}${BOLD}${mode_val} 모드 (알수없음)${C_RST}"
    fi
  else
    mode_label="${C_RED}${BOLD}조회실패 · 응답: ${SNAP_MODE_JSON:0:60}${C_RST}"
  fi

  local ws_enabled ws_open ws_last_rx ws_count ws_error ws_summary
  ws_enabled=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("enabled")' '')
  ws_open=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("wsConnected")' '')
  ws_last_rx=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("lastMessageAt")' '')
  ws_count=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("receivedCount")' '0')
  ws_error=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("error")' '')

  if [ "$ws_open" = "true" ]; then
    ws_pill="${C_GREEN}● CONNECTED${C_RST}"
  elif [ "$ws_enabled" = "true" ]; then
    ws_pill="${C_YELLOW}⚠ ENABLED · WS 미연결${C_RST}"
  else
    ws_pill="${C_DIM}○ disabled${C_RST}"
  fi

  local hub_ok hub_disabled hub_email hub_linked hub_last_ingest_at hub_last_ingest_ok hub_last_status_at hub_last_status_ok hub_log_n hub_pill
  hub_ok=$(json_field_str "$SNAP_HUB_JSON" 'd.get("ok")' '')
  hub_disabled=$(json_field_str "$SNAP_HUB_JSON" 'd.get("disabled")' '')
  hub_email=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("email")' '')
  hub_linked=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("linkedAt")' '')
  hub_last_ingest_at=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("lastIngestAt")' '')
  hub_last_ingest_ok=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("lastIngestOk")' '')
  hub_last_status_at=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("lastStatusAt")' '')
  hub_last_status_ok=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("lastStatusOk")' '')
  hub_log_n=$(json_field_str "$SNAP_HUB_JSON" 'len(d.get("logs") or [])' '0')

  if [ "$hub_ok" = "true" ]; then
    if [ -n "$hub_email" ] && [ "$hub_email" != "null" ] && [ -n "$hub_email" ]; then
      if [ "$hub_last_ingest_ok" = "true" ]; then
        hub_pill="${C_GREEN}● 로그인됨 · ingest OK${C_RST}"
      elif [ "$hub_last_ingest_ok" = "false" ]; then
        hub_pill="${C_RED}✖ 로그인됨 · ingest FAIL${C_RST}"
      else
        hub_pill="${C_YELLOW}◐ 로그인됨 · ingest 미수신${C_RST}"
      fi
    else
      hub_pill="${C_YELLOW}⚠ 미로그인 · B 모드 사용전 로그인 필요${C_RST}"
    fi
  else
    hub_pill="${C_RED}✖ /api/toona/hub 응답거부 (COOKIE 설정 필요?)${C_RST}"
  fi

  local q_len un_len
  q_len=$(json_field_str "$SNAP_QUEUE_JSON" 'len(d.get("items") or [])' '0')
  un_len=$(json_field_str "$SNAP_UNMATCH_JSON" 'len(d.get("items") or [])' '0')
  if ! [[ "$q_len" =~ ^[0-9]+$ ]]; then q_len=0; fi
  if ! [[ "$un_len" =~ ^[0-9]+$ ]]; then un_len=0; fi

  local donors_n donors_sum donors_list donors_sample
  donors_n=$(json_field_str "$SNAP_STATE_JSON" 'len(d.get("donors") or [])' '0')
  donors_sum=$("$PY" -c '
import json,sys
try:
  d=json.loads(sys.stdin.read() or "{}")
except Exception:
  print(0); sys.exit(0)
arr=d.get("donors") or []
s=0
for x in arr:
  try: s += int(x.get("amount") or 0)
  except: pass
print(s)
' <<< "$SNAP_STATE_JSON")
  donors_list_tmp="$TMP_DIR/donors.txt"
  json_list_tail_donors "$SNAP_STATE_JSON" 'd.get("donors") or []' 100 > "$donors_list_tmp"
  donors_list_head_tmp="$TMP_DIR/hub_logs.txt"
  json_list_tail_donors "$SNAP_HUB_JSON" 'd.get("logs") or d.get("donationLogs") or []' 50 > "$donors_list_head_tmp"

  local panel_w=$(( (cols - 8) / 2 ))
  [ $panel_w -lt 40 ] && panel_w=40

  # === [좌] 투네 WS 리스너 ===
  printf ' %s%-*s%s%s\n' "${C_CYAN}│ ${C_RST}${BOLD}[A] 투네 WS 직결 리스너${C_RST}" "$((panel_w - 20))" "" "" "${C_CYAN} │${C_RST}"
  local ws_line1="상태: $ws_pill"
  local ws_line2="수신 누적: ${ws_count}건 · 마지막 수신: $(fmt_ago "$ws_last_rx")"
  local ws_line3="링크 활성: ${ws_enabled} · 에러: ${ws_error}"
  printf '%s%*s%s\n' "${C_CYAN}│ ${C_RST}  ${ws_line1}" "$((cols - 8 - 2 - ${#ws_line1}))" "" "${C_CYAN} │${C_RST}"
  printf '%s%*s%s\n' "${C_CYAN}│ ${C_RST}  ${ws_line2}" "$((cols - 8 - 2 - ${#ws_line2}))" "" "${C_CYAN} │${C_RST}"
  printf '%s%*s%s\n' "${C_CYAN}│ ${C_RST}  ${ws_line3}" "$((cols - 8 - 2 - ${#ws_line3}))" "" "${C_CYAN} │${C_RST}"

  # === [우] DIN 허브 폴러 ===
  printf '%s%*s%s\n' "${C_CYAN}│${C_RST}  ${BOLD}[B] DIN 허브 폴러${C_RST}: $hub_pill" "$((cols - 8 - 2 - 6 - ${#hub_pill}))" "" "${C_CYAN} │${C_RST}"
  local hub_line1="계정: ${hub_email:-<미로그인>} · 연동: $(fmt_ago "$hub_linked")"
  local hub_line2="Ingest: $( [ "$hub_last_ingest_ok" = "true" ] && printf '%sOK%s' "$C_GREEN" "$C_RST" || [ "$hub_last_ingest_ok" = "false" ] && printf '%sFAIL%s' "$C_RED" "$C_RST" || printf '%s—%s' "$C_DIM" "$C_RST" ) · $(fmt_ago "$hub_last_ingest_at")  · Status: $( [ "$hub_last_status_ok" = "true" ] && printf '%sOK%s' "$C_GREEN" "$C_RST" || [ "$hub_last_status_ok" = "false" ] && printf '%sFAIL%s' "$C_RED" "$C_RST" || printf '%s—%s' "$C_DIM" "$C_RST" ) · $(fmt_ago "$hub_last_status_at")"
  local hub_line3="로그 개수: ${hub_log_n}건 · B모드 disabled=${hub_disabled:-false}"
  printf '%s%*s%s\n' "${C_CYAN}│ ${C_RST}  ${hub_line1}" "$((cols - 8 - 2 - ${#hub_line1}))" "" "${C_CYAN} │${C_RST}"
  printf '%s%*s%s\n' "${C_CYAN}│ ${C_RST}  ${hub_line2}" "$((cols - 8 - 2 - ${#hub_line2}))" "" "${C_CYAN} │${C_RST}"
  printf '%s%*s%s\n' "${C_CYAN}│ ${C_RST}  ${hub_line3}" "$((cols - 8 - 2 - ${#hub_line3}))" "" "${C_CYAN} │${C_RST}"

  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "$((cols-2))" "" "${C_CYAN}─┤${C_RST}"

  # === 현재 Runtime 모드 + 요약 ===
  local sum_line="▶ 런타임 모드: $mode_label ｜ A/B 짧은설명: ${short} ｜ ${desc}"
  printf '%s%*s%s\n' "${C_CYAN}│ ${C_RST}${sum_line}" "$((cols - 4 - ${#sum_line} + ${#BOLD} + ${#C_RST}*6))" "" "${C_CYAN} │${C_RST}" | cut -c1-"$cols"

  local sum_line2="전체 후원 ${BOLD}${donors_n}${C_RST}건 · 누적 $(fmt_krw "$donors_sum") · 미처리 QUEUE ${q_len}건 · 미매칭 UNMATCH ${un_len}건"
  printf '%s%*s%s\n' "${C_CYAN}│ ${C_RST}${sum_line2}" "$((cols - 4 - ${#sum_line2} + ${#BOLD} + ${#C_RST}*2))" "" "${C_CYAN} │${C_RST}"

  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "$((cols-2))" "" "${C_CYAN}─┤${C_RST}"

  # === 최근 후원 로그: hub logs 위 / state donors 아래 합쳐서 최신 N개 ===
  local recent_body="$TMP_DIR/recent.txt"
  : > "$recent_body"
  if [ -s "$donors_list_head_tmp" ]; then
    cat "$donors_list_head_tmp" >> "$recent_body"
  fi
  if [ -s "$donors_list_tmp" ]; then
    cat "$donors_list_tmp" >> "$recent_body"
  fi

  local log_rows=$(( lines - 14 ))
  [ $log_rows -lt 4 ] && log_rows=4

  printf '%s%s%*s%s%s\n' "${C_CYAN}│ ${C_RST}${BOLD}📌 최근 후원 로그 (표시 영역 ${log_rows}행, 오래된 순 → 최신 순)${C_RST}" "$((cols - 6 - 40))" "" "${C_DIM}  [q=종료 r=새로고침 h=도움]${C_RST}" "${C_CYAN} │${C_RST}" | cut -c1-"$cols"

  local shown=0
  if [ -s "$recent_body" ]; then
    awk 'NF && !seen[$0]++' "$recent_body" 2>/dev/null | head -n "$log_rows" | while IFS= read -r line; do
      shown=$((shown+1))
      printf '%s%s%*s%s\n' "${C_CYAN}│ ${C_RST}  ${C_DIM}·${C_RST} $line" "$((cols - 6 - ${#line}))" "" "${C_CYAN} │${C_RST}" | cut -c1-"$cols"
    done
  else
    printf '%s%s%*s%s\n' "${C_CYAN}│ ${C_RST}   ${C_DIM}(아직 수신된 후원 로그가 없거나 state/hub 응답이 비었습니다)${C_RST}" "$((cols - 6 - 40))" "" "${C_CYAN} │${C_RST}"
  fi

  for ((; shown<log_rows; shown++)); do
    printf '%s%*s%s\n' "${C_CYAN}│ ${C_RST}" "$((cols-4))" "" "${C_CYAN} │${C_RST}"
  done

  printf '%s%*s%s\n' "${C_CYAN}└─${C_RST}" "$((cols-2))" "" "${C_CYAN}─┘${C_RST}"
}

render_help() {
  local cols lines
  cols=$(tput cols 2>/dev/null || echo 120)
  lines=$(tput lines 2>/dev/null || echo 40)
  clear
  printf '\033[H'
  echo "${BOLD}${C_CYAN}━━━━━━━━━━━ DIN Studio 후원 모니터 · 도움말 ━━━━━━━━━━━${C_RST}"
  echo ""
  echo "  ${BOLD}${C_YELLOW}핫키:${C_RST}"
  echo "    ${BOLD}q${C_RST} / Ctrl+C  종료"
  echo "    ${BOLD}r${C_RST}         즉시 새로고침 (refresh 주기 무시)"
  echo "    ${BOLD}h${C_RST}         이 도움말 토글"
  echo ""
  echo "  ${BOLD}${C_YELLOW}환경변수:${C_RST}"
  echo "    TARGET_USER=finalent       · 모니터링 대상 유저 ID (필수, 관리자 ?u= 에 사용)"
  echo "    PORT=3000                  · pm2 앱 포트"
  echo "    BASE_URL=http://127.0.0.1:3000  · 커스텀 Base URL"
  echo "    REFRESH_MS=2000            · 새로고침 주기 (밀리초)"
  echo "    COOKIE='sb_user=xxx; ...'  · 관리자 쿠키 (write 권한 API / hub session 읽기에 필요)"
  echo "    MODE=once                  · 1회 덤프 + TUI 비활성 (CI/cron 로그용)"
  echo "    NO_COLOR=1                 · ANSI 색상 제거 · grep 용이"
  echo ""
  echo "  ${BOLD}${C_YELLOW}로그 패널 설명:${C_RST}"
  echo "    [A] 투네 WS 직결        · 투네이션 WebSocket 서버 리스너 상태. ● = 연결, ⚠ = 설정됐지만 소켓 없음"
  echo "    [B] DIN 허브 폴러       · B 모드 전용 30s/60s 폴러. Ingest OK → 수집 정상, Ingest FAIL → 원인은 EC2 logs 확인"
  echo "    QUEUE                   · 수신됐지만 아직 apply 안된 후원 (오류나 memberAutoAssigned 실패시 쌓임)"
  echo "    UNMATCH                 · 멤버 추정 실패 / 시그 매칭 실패 등 후원은 있지만 엑셀 반영 안된 항목"
  echo "    최근 후원 로그            · state donors + hub logs 를 합쳐서 신규 수신 순으로 표시"
  echo ""
  echo "  ${BOLD}${C_YELLOW}트러블슈팅 팁:${C_RST}"
  echo "    ① /api/toona/hub 응답이 'unauthorized' → 관리자 페이지 로그인 후 sb_user 쿠키를 COOKIE= 로 넘기세요."
  echo "    ② B 모드인데 hub_last_ingest_ok = false → \`pm2 logs youtube --lines 200 --nostream\` 에서 poller 스택트레이스 확인."
  echo "    ③ A 모드인데 ws 미연결 → 링크키 alertboxUrl 이 올바른지 (http://toon.at/alertbox/xxx) 확인 · POST sync 강제."
  echo ""
  read -n 1 -s -r -p "  [ 아무 키나 눌러서 돌아가기 ] " _unused
}

check_pm2_alive() {
  if command -v pm2 >/dev/null 2>&1; then
    pm2 jlist 2>/dev/null | "$PY" -c "
import json,sys
try:
  arr=json.loads(sys.stdin.read() or '[]')
  for x in arr:
    if x.get('name')==sys.argv[1]:
      print('pid=',x.get('pid') or '?','pm2_uptime=',int((x.get('pm2_env') or {}).get('pm_uptime') or 0)//1000,'s status=',x.get('pm2_env',{}).get('status'))
      break
except Exception: pass
" "$APP_NAME" 2>/dev/null
  fi
}

if [ "$MODE_ONCE" = "1" ]; then
  collect_snapshot
  render_ui
  exit 0
fi

if [ ! -t 0 ]; then
  echo "Warning: TTY가 아니라서 TUI 입력이 안됩니다. MODE=once 로 1회 덤프를 사용하세요." >&2
  MODE_ONCE=1
  collect_snapshot
  render_ui
  exit 0
fi

stty -echo 2>/dev/null
printf '\033[?25l'

SHOW_HELP=0
while true; do
  collect_snapshot
  if [ "$SHOW_HELP" = "1" ]; then
    render_help
    SHOW_HELP=0
    read -n 1 -t 0.1 -r -s _unused || true
    continue
  fi
  render_ui

  read_cmd=""
  IFS= read -r -s -n 1 -t "$((REFRESH_MS/1000)).$(( (REFRESH_MS%1000)/100 ))" read_cmd 2>/dev/null || read_cmd=""
  case "$read_cmd" in
    q|Q) break ;;
    r|R) continue ;;
    h|H) SHOW_HELP=1 ;;
    "") ;;
    *) ;;
  esac
done

exit 0
