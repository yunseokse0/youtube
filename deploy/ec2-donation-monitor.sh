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
FRAME_BUF="$TMP_DIR/framebuf.txt"
: > "$FRAME_BUF"
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

# ANSI escape 코드를 제거한 실제 표시 길이 (단일 AWK → 서브쉘 오버헤드 극소화)
visible_len() {
  local s="$1"
  local n
  n=$(printf '%s' "$s" | awk '{
    gsub(/\x1B\[[0-9;]*[a-zA-Z]/,"")
    gsub(/[\x01-\x1F\x7F]/,"")
    print length($0)
  }' 2>/dev/null)
  [ -z "$n" ] && n=0
  if ! [[ "$n" =~ ^[0-9]+$ ]]; then n=0; fi
  echo "$n"
}

safe_pad_from() {
  local line="$1" avail="$2"
  [ -z "$avail" ] && avail=0
  if ! [[ "$avail" =~ ^-?[0-9]+$ ]]; then avail=0; fi
  local vlen
  vlen="$(visible_len "$line")"
  [ -z "$vlen" ] && vlen=0
  if ! [[ "$vlen" =~ ^[0-9]+$ ]]; then vlen=0; fi
  local pad=$(( avail - vlen ))
  if [ "$pad" -lt 0 ]; then pad=0; fi
  echo "$pad"
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
  local pad
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

  pad="$(safe_pad $((cols - 2)))"
  printf '%s%*s%s\n' "${BOLD}${C_CYAN}┌─${C_RST}" "${pad:-0}" "" "${BOLD}${C_CYAN}─┐${C_RST}"

  local line1_hdr="${C_CYAN}│${C_RST} ${hdr} ${C_DIM}refresh every $((REFRESH_MS/1000))s · ${now}${C_RST}"
  pad="$(safe_pad_from "$line1_hdr" "$(( cols - 2 ))" )"
  printf '%s%*s%s\n' "$line1_hdr" "${pad:-0}" "" "${C_CYAN}│${C_RST}" | cut -c1-"$cols"
  pad="$(safe_pad $((cols - 2)))"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"

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
  local ws_title_line="${C_CYAN}│ ${C_RST}${BOLD}[A] 투네 WS 직결 리스너${C_RST}"
  pad="$(safe_pad_from "$ws_title_line" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$ws_title_line" "${pad:-0}" "" "${C_CYAN} │${C_RST}"

  local ws_line1="상태: $ws_pill"
  local ws_line2="수신 누적: ${ws_count}건 · 마지막 수신: $(fmt_ago "$ws_last_rx")"
  local ws_line3="링크 활성: ${ws_enabled} · 에러: ${ws_error}"

  local ln1="${C_CYAN}│ ${C_RST}  ${ws_line1}"
  pad="$(safe_pad_from "$ln1" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$ln1" "${pad:-0}" "" "${C_CYAN} │${C_RST}"
  local ln2="${C_CYAN}│ ${C_RST}  ${ws_line2}"
  pad="$(safe_pad_from "$ln2" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$ln2" "${pad:-0}" "" "${C_CYAN} │${C_RST}"
  local ln3="${C_CYAN}│ ${C_RST}  ${ws_line3}"
  pad="$(safe_pad_from "$ln3" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$ln3" "${pad:-0}" "" "${C_CYAN} │${C_RST}"

  # === [우] DIN 허브 폴러 ===
  local hub_title_line="${C_CYAN}│${C_RST}  ${BOLD}[B] DIN 허브 폴러${C_RST}: $hub_pill"
  pad="$(safe_pad_from "$hub_title_line" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$hub_title_line" "${pad:-0}" "" "${C_CYAN} │${C_RST}"
  local hub_line1="계정: ${hub_email:-<미로그인>} · 연동: $(fmt_ago "$hub_linked")"
  local hub_line2="Ingest: $( [ "$hub_last_ingest_ok" = "true" ] && printf '%sOK%s' "$C_GREEN" "$C_RST" || [ "$hub_last_ingest_ok" = "false" ] && printf '%sFAIL%s' "$C_RED" "$C_RST" || printf '%s—%s' "$C_DIM" "$C_RST" ) · $(fmt_ago "$hub_last_ingest_at")  · Status: $( [ "$hub_last_status_ok" = "true" ] && printf '%sOK%s' "$C_GREEN" "$C_RST" || [ "$hub_last_status_ok" = "false" ] && printf '%sFAIL%s' "$C_RED" "$C_RST" || printf '%s—%s' "$C_DIM" "$C_RST" ) · $(fmt_ago "$hub_last_status_at")"
  local hub_line3="로그 개수: ${hub_log_n}건 · B모드 disabled=${hub_disabled:-false}"

  local hl1="${C_CYAN}│ ${C_RST}  ${hub_line1}"
  pad="$(safe_pad_from "$hl1" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$hl1" "${pad:-0}" "" "${C_CYAN} │${C_RST}"
  local hl2="${C_CYAN}│ ${C_RST}  ${hub_line2}"
  pad="$(safe_pad_from "$hl2" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$hl2" "${pad:-0}" "" "${C_CYAN} │${C_RST}"
  local hl3="${C_CYAN}│ ${C_RST}  ${hub_line3}"
  pad="$(safe_pad_from "$hl3" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$hl3" "${pad:-0}" "" "${C_CYAN} │${C_RST}"

  pad="$(safe_pad $((cols - 2)))"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"

  # === 현재 Runtime 모드 + 요약 ===
  local sum_line="${C_CYAN}│ ${C_RST}▶ 런타임 모드: $mode_label ｜ A/B 짧은설명: ${short} ｜ ${desc}"
  pad="$(safe_pad_from "$sum_line" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$sum_line" "${pad:-0}" "" "${C_CYAN} │${C_RST}" | cut -c1-"$cols"

  local sum_line2="${C_CYAN}│ ${C_RST}전체 후원 ${BOLD}${donors_n}${C_RST}건 · 누적 $(fmt_krw "$donors_sum") · 미처리 QUEUE ${q_len}건 · 미매칭 UNMATCH ${un_len}건"
  pad="$(safe_pad_from "$sum_line2" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$sum_line2" "${pad:-0}" "" "${C_CYAN} │${C_RST}"

  pad="$(safe_pad $((cols - 2)))"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"

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

  local log_hdr="${C_CYAN}│ ${C_RST}${BOLD}📌 최근 후원 로그 (표시 영역 ${log_rows}행)${C_RST}${C_DIM}  [q=종료 r=새로고침 h=도움 t=추세 d=정합성 v=되돌리기]${C_RST}"
  pad="$(safe_pad_from "$log_hdr" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$log_hdr" "${pad:-0}" "" "${C_CYAN} │${C_RST}" | cut -c1-"$cols"

  local shown=0
  if [ -s "$recent_body" ]; then
    awk 'NF && !seen[$0]++' "$recent_body" 2>/dev/null | head -n "$log_rows" | while IFS= read -r line; do
      shown=$((shown+1))
      local lline="${C_CYAN}│ ${C_RST}  ${C_DIM}·${C_RST} $line"
      pad="$(safe_pad_from "$lline" "$(( cols - 4 ))" )"
      printf '%s%*s%s\n' "$lline" "${pad:-0}" "" "${C_CYAN} │${C_RST}" | cut -c1-"$cols"
    done
  else
    local empty_line="${C_CYAN}│ ${C_RST}   ${C_DIM}(아직 수신된 후원 로그가 없거나 state/hub 응답이 비었습니다)${C_RST}"
    pad="$(safe_pad_from "$empty_line" "$(( cols - 4 ))" )"
    printf '%s%*s%s\n' "$empty_line" "${pad:-0}" "" "${C_CYAN} │${C_RST}"
  fi

  for ((; shown<log_rows; shown++)); do
    local bl="${C_CYAN}│ ${C_RST}"
    pad="$(safe_pad_from "$bl" "$(( cols - 4 ))" )"
    printf '%s%*s%s\n' "$bl" "${pad:-0}" "" "${C_CYAN} │${C_RST}"
  done

  pad="$(safe_pad $((cols - 2)))"
  printf '%s%*s%s\n' "${C_CYAN}└─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┘${C_RST}"
}

render_help() {
  local cols lines
  cols=$(tput cols 2>/dev/null || echo 120)
  lines=$(tput lines 2>/dev/null || echo 40)
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

# ------------------------------------------------------------------
# 시계열 추세 저장 · 4단계 RRA (Round Robin Archive · CSV)
# 컬럼: ts_ms, mode(A/B/?), donors_n, donors_sum_won, queue_n, unmatch_n,
#       ws_open(0/1/-), ws_rx_cnt, hub_ingest_ok(0/1/-), hub_ingest_ago_s, hub_status_ok(0/1/-), hub_logs_n,
#       hub_sum_won(최근 1시간 hub logs), hub_count(최근 1시간 hub logs 건수)
# ------------------------------------------------------------------
TS_DIR="${TS_DIR:-${HOME}/.din-studio/donation-ts}"
mkdir -p "$TS_DIR" 2>/dev/null
TS_RAW="${TS_DIR}/raw-${TARGET_USER}.csv"
TS_R1M="${TS_DIR}/r1m-${TARGET_USER}.csv"
TS_R10M="${TS_DIR}/r10m-${TARGET_USER}.csv"
TS_R1H="${TS_DIR}/r1h-${TARGET_USER}.csv"
TS_HDR="ts_ms,mode,donors_n,donors_sum_won,queue_n,unmatch_n,ws_open,ws_rx_cnt,hub_ingest_ok,hub_ingest_ago_s,hub_status_ok,hub_logs_n,hub_sum_won_l1h,hub_count_l1h"

for _f in "$TS_RAW" "$TS_R1M" "$TS_R10M" "$TS_R1H"; do
  if [ ! -f "$_f" ] || [ ! -s "$_f" ]; then
    echo "$TS_HDR" > "$_f" 2>/dev/null
  fi
done

# 2s 단위 raw = 최근 300개 (10분) 유지. 초과시 오래된 행 삭제
ts_raw_cap="${TS_RAW_CAP:-300}"
ts_r1m_cap="${TS_R1M_CAP:-720}"     # 1분 단위 720개 = 12시간
ts_r10m_cap="${TS_R10M_CAP:-144}"   # 10분 단위 144개 = 24시간
ts_r1h_cap="${TS_R1H_CAP:-60}"      # 1시간 단위 60개 = 60일

ts_bucket_ts() {
  local ms="$1" sec="$2"
  printf $(( (ms / 1000 / sec) * sec * 1000 ))
}

ts_append() {
  local ts="$1" line="$2"
  [ -z "$ts" ] || [ -z "$line" ] && return 0
  echo "${ts},${line}" >> "$TS_RAW" 2>/dev/null
  # cap 유지 (tail -n 은 느리니 python 으로)
  "$PY" -c "
import sys,os
p=sys.argv[1]; cap=int(sys.argv[2])
if not os.path.isfile(p): sys.exit(0)
with open(p,'rb') as f: lines=f.read().splitlines()
hdr=lines[0:1]
tail=lines[-cap:] if len(lines)>cap+1 else lines[1:]
with open(p,'wb') as f: f.write(b'\n'.join(hdr+tail)+b'\n')
" "$TS_RAW" "$ts_raw_cap" 2>/dev/null

  # 1분 롤업
  "$PY" -c "
import sys,os
raw=sys.argv[1]; out=sys.argv[2]; bucket=int(sys.argv[3]); cap=int(sys.argv[4])
def avg(xs):
  xs=[v for v in xs if v not in (None,'') and str(v).replace('-','').isdigit()]
  return sum(map(int,xs))//len(xs) if xs else ''
def maxs(xs):
  xs=[int(v) for v in xs if str(v).lstrip('-').isdigit()]
  return max(xs) if xs else ''
def sums(xs):
  xs=[int(v) for v in xs if str(v).lstrip('-').isdigit()]
  return sum(xs) if xs else ''
def modebucket(rows):
  from collections import Counter
  c=Counter([r[1] for r in rows if r and r[1]])
  return c.most_common(1)[0][0] if c else '?'
if not os.path.isfile(raw): sys.exit(0)
with open(raw,'r') as f: lines=f.read().splitlines()
if len(lines)<2: sys.exit(0)
hdr=lines[0]; cols=hdr.split(',')
rows=[l.split(',',len(cols)-1) for l in lines[1:] if l.strip()]
by_b={}
for r in rows:
  try:
    ts=int(r[0]); key=(ts//(bucket*1000))*(bucket*1000)
  except Exception: continue
  by_b.setdefault(key,[]).append(r)
merged_hdr=hdr
out_exists=os.path.isfile(out) and os.path.getsize(out)>0
existing={}
if out_exists:
  with open(out,'r') as f: olines=f.read().splitlines()
  existing_hdr=olines[0]
  for l in olines[1:]:
    p=l.split(',',len(cols)-1)
    try: existing[int(p[0])]=l
    except Exception: pass
written=[]
for k in sorted(by_b.keys()):
  rs=by_b[k]
  vs=[str(k),
      modebucket(rs),
      str(avg([r[2] for r in rs if len(r)>2])),
      str(maxs([r[3] for r in rs if len(r)>3])),
      str(maxs([r[4] for r in rs if len(r)>4])),
      str(maxs([r[5] for r in rs if len(r)>5])),
      str(maxs([r[6] for r in rs if len(r)>6])),
      str(maxs([r[7] for r in rs if len(r)>7])),
      str(maxs([r[8] for r in rs if len(r)>8])),
      str(min([int(r[9]) for r in rs if len(r)>9 and str(r[9]).isdigit()]) or ''),
      str(maxs([r[10] for r in rs if len(r)>10])),
      str(maxs([r[11] for r in rs if len(r)>11])),
      str(maxs([r[12] for r in rs if len(r)>12])),
      str(maxs([r[13] for r in rs if len(r)>13]))
  ]
  line=','.join([v if v!='' else '' for v in vs])
  existing[k]=line
ordered=sorted(existing.keys())[-cap:]
with open(out,'w') as f:
  f.write(merged_hdr+'\n')
  for k in ordered: f.write(existing[k]+'\n')
" "$TS_RAW" "$TS_R1M" 60 "$ts_r1m_cap" 2>/dev/null
  # 10분 롤업
  "$PY" -c "
import sys,os
raw=sys.argv[1]; out=sys.argv[2]; bucket=int(sys.argv[3]); cap=int(sys.argv[4])
def avg(xs):
  xs=[v for v in xs if v not in (None,'') and str(v).replace('-','').isdigit()]
  return sum(map(int,xs))//len(xs) if xs else ''
def maxs(xs):
  xs=[int(v) for v in xs if str(v).lstrip('-').isdigit()]
  return max(xs) if xs else ''
def modebucket(rows):
  from collections import Counter
  c=Counter([r[1] for r in rows if r and r[1]])
  return c.most_common(1)[0][0] if c else '?'
if not os.path.isfile(raw): sys.exit(0)
with open(raw,'r') as f: lines=f.read().splitlines()
if len(lines)<2: sys.exit(0)
hdr=lines[0]; cols=hdr.split(',')
rows=[l.split(',',len(cols)-1) for l in lines[1:] if l.strip()]
by_b={}
for r in rows:
  try:
    ts=int(r[0]); key=(ts//(bucket*1000))*(bucket*1000)
  except Exception: continue
  by_b.setdefault(key,[]).append(r)
existing={}
out_exists=os.path.isfile(out) and os.path.getsize(out)>0
if out_exists:
  with open(out,'r') as f: olines=f.read().splitlines()
  for l in olines[1:]:
    p=l.split(',',len(cols)-1)
    try: existing[int(p[0])]=l
    except Exception: pass
for k in sorted(by_b.keys()):
  rs=by_b[k]
  vs=[str(k), modebucket(rs),
      str(avg([r[2] for r in rs if len(r)>2])),
      str(maxs([r[3] for r in rs if len(r)>3])),
      str(maxs([r[4] for r in rs if len(r)>4])),
      str(maxs([r[5] for r in rs if len(r)>5])),
      str(maxs([r[6] for r in rs if len(r)>6])),
      str(maxs([r[7] for r in rs if len(r)>7])),
      str(maxs([r[8] for r in rs if len(r)>8])),
      '' if not [int(r[9]) for r in rs if len(r)>9 and str(r[9]).isdigit()] else str(min([int(r[9]) for r in rs if len(r)>9 and str(r[9]).isdigit()])),
      str(maxs([r[10] for r in rs if len(r)>10])),
      str(maxs([r[11] for r in rs if len(r)>11])),
      str(maxs([r[12] for r in rs if len(r)>12])),
      str(maxs([r[13] for r in rs if len(r)>13]))
  ]
  line=','.join(vs)
  existing[k]=line
ordered=sorted(existing.keys())[-cap:]
with open(out,'w') as f:
  f.write(hdr+'\n')
  for k in ordered: f.write(existing[k]+'\n')
" "$TS_R1M" "$TS_R10M" 10 "$ts_r10m_cap" 2>/dev/null
  # 1시간 롤업
  "$PY" -c "
import sys,os
raw=sys.argv[1]; out=sys.argv[2]; bucket=int(sys.argv[3]); cap=int(sys.argv[4])
def avg(xs):
  xs=[v for v in xs if v not in (None,'') and str(v).replace('-','').isdigit()]
  return sum(map(int,xs))//len(xs) if xs else ''
def maxs(xs):
  xs=[int(v) for v in xs if str(v).lstrip('-').isdigit()]
  return max(xs) if xs else ''
def modebucket(rows):
  from collections import Counter
  c=Counter([r[1] for r in rows if r and r[1]])
  return c.most_common(1)[0][0] if c else '?'
if not os.path.isfile(raw): sys.exit(0)
with open(raw,'r') as f: lines=f.read().splitlines()
if len(lines)<2: sys.exit(0)
hdr=lines[0]; cols=hdr.split(',')
rows=[l.split(',',len(cols)-1) for l in lines[1:] if l.strip()]
by_b={}
for r in rows:
  try:
    ts=int(r[0]); key=(ts//(bucket*1000))*(bucket*1000)
  except Exception: continue
  by_b.setdefault(key,[]).append(r)
existing={}
out_exists=os.path.isfile(out) and os.path.getsize(out)>0
if out_exists:
  with open(out,'r') as f: olines=f.read().splitlines()
  for l in olines[1:]:
    p=l.split(',',len(cols)-1)
    try: existing[int(p[0])]=l
    except Exception: pass
for k in sorted(by_b.keys()):
  rs=by_b[k]
  vs=[str(k), modebucket(rs),
      str(avg([r[2] for r in rs if len(r)>2])),
      str(maxs([r[3] for r in rs if len(r)>3])),
      str(maxs([r[4] for r in rs if len(r)>4])),
      str(maxs([r[5] for r in rs if len(r)>5])),
      str(maxs([r[6] for r in rs if len(r)>6])),
      str(maxs([r[7] for r in rs if len(r)>7])),
      str(maxs([r[8] for r in rs if len(r)>8])),
      '' if not [int(r[9]) for r in rs if len(r)>9 and str(r[9]).isdigit()] else str(min([int(r[9]) for r in rs if len(r)>9 and str(r[9]).isdigit()])),
      str(maxs([r[10] for r in rs if len(r)>10])),
      str(maxs([r[11] for r in rs if len(r)>11])),
      str(maxs([r[12] for r in rs if len(r)>12])),
      str(maxs([r[13] for r in rs if len(r)>13]))
  ]
  line=','.join(vs)
  existing[k]=line
ordered=sorted(existing.keys())[-cap:]
with open(out,'w') as f:
  f.write(hdr+'\n')
  for k in ordered: f.write(existing[k]+'\n')
" "$TS_R10M" "$TS_R1H" 60 "$ts_r1h_cap" 2>/dev/null
}

ts_collect_now() {
  local ts_ms
  ts_ms=$(date +%s%3N)
  local mode_v donors_n_v donors_sum_v q_v un_v wsopen_v wsrx_v hok_v hago_s hsok_v hlogn_v hsum_l1h_v hcnt_l1h_v
  mode_v="$(json_field_str "$SNAP_MODE_JSON" 'd.get("mode")' '?')"
  donors_n_v="${donors_n:-0}"
  donors_sum_v="${donors_sum:-0}"
  q_v="${q_len:-0}"
  un_v="${un_len:-0}"
  [ "${ws_open:-}" = "true" ] && wsopen_v=1 || [ "${ws_open:-}" = "false" ] && wsopen_v=0 || wsopen_v="-"
  wsrx_v="${ws_count:-0}"
  [ "${hub_last_ingest_ok:-}" = "true" ] && hok_v=1 || [ "${hub_last_ingest_ok:-}" = "false" ] && hok_v=0 || hok_v="-"
  if [[ "${hub_last_ingest_at:-}" =~ ^[0-9]+$ ]]; then
    hago_s=$(( (ts_ms - hub_last_ingest_at) / 1000 ))
    [ "$hago_s" -lt 0 ] && hago_s=0
    hago_s_v="$hago_s"
  else
    hago_s_v="-"
  fi
  [ "${hub_last_status_ok:-}" = "true" ] && hsok_v=1 || [ "${hub_last_status_ok:-}" = "false" ] && hsok_v=0 || hsok_v="-"
  hlogn_v="${hub_log_n:-0}"

  local hub_hour_stats_file="$TMP_DIR/hub_hour.json"
  "$PY" -c "
import json,sys
try:
  d=json.loads(sys.stdin.read() or '{}')
except Exception:
  print(json.dumps({'sum':0,'count':0})); sys.exit(0)
logs=d.get('logs') or d.get('donationLogs') or []
if not isinstance(logs,list): logs=[]
import time
cutoff=int(time.time()*1000)-3600*1000
s=0; c=0
for l in logs:
  try:
    at=l.get('at') or l.get('ingestedAt') or 0
    if isinstance(at,str):
      from datetime import datetime
      try: at=int(datetime.fromisoformat(at.replace('Z','+00:00')).timestamp()*1000)
      except Exception: at=0
    amt=int(l.get('amount') or 0)
    if at and at>=cutoff and amt>0: s+=amt; c+=1
  except Exception: pass
print(json.dumps({'sum':s,'count':c}))
" <<< "$SNAP_HUB_JSON" > "$hub_hour_stats_file" 2>/dev/null
  hsum_l1h_v=$("$PY" -c "import json,sys
try: d=json.loads(open(sys.argv[1]).read()); print(d.get('sum',0))
except Exception: print(0)" "$hub_hour_stats_file" 2>/dev/null)
  hcnt_l1h_v=$("$PY" -c "import json,sys
try: d=json.loads(open(sys.argv[1]).read()); print(d.get('count',0))
except Exception: print(0)" "$hub_hour_stats_file" 2>/dev/null)

  [ -z "$donors_n_v" ] && donors_n_v=0
  [ -z "$donors_sum_v" ] && donors_sum_v=0
  ts_append "$ts_ms" "${mode_v},${donors_n_v},${donors_sum_v},${q_v},${un_v},${wsopen_v},${wsrx_v},${hok_v},${hago_s_v},${hsok_v},${hlogn_v},${hsum_l1h_v},${hcnt_l1h_v}"
}

# ------------------------------------------------------------------
# ASCII 시계열 차트 렌더 · RRA 파일 → 지정 컬럼 → N 틱 세로 막대
# ------------------------------------------------------------------
ts_ascii_chart() {
  local csv="$1" col="$2" ticks="$3" label="$4"
  [ -f "$csv" ] || return 0
  [ "$ticks" -gt 2 ] 2>/dev/null || ticks=40
  "$PY" -c "
import sys,os
p=sys.argv[1]; col=sys.argv[2]; ticks=int(sys.argv[3]); label=sys.argv[4]
if not os.path.isfile(p):
  sys.stdout.write('(no data)'); sys.exit(0)
with open(p) as f: lines=f.read().splitlines()
if len(lines)<2:
  sys.stdout.write('(no data)'); sys.exit(0)
hdr=lines[0].split(','); rows=[]
for l in lines[1:]:
  r=l.split(',',len(hdr)-1)
  if len(r)<=0: continue
  rows.append(r)
if not rows:
  sys.stdout.write('(no data)'); sys.exit(0)
try: ci=hdr.index(col)
except ValueError:
  sys.stdout.write(f'(col {col} 없음: '+'/'.join(hdr)+')'); sys.exit(0)
vals=[]
for r in rows:
  v=r[ci] if len(r)>ci else ''
  try: vals.append(int(v))
  except Exception: continue
if not vals:
  sys.stdout.write('(all NA)'); sys.exit(0)
# 최근 ticks 개만
vals=vals[-ticks:]
# 최소/최대 정규화
vmin=min(vals); vmax=max(vals)
if vmax==vmin: bars=['█' if v>0 else ' ' for v in vals]
else:
  # block element 8단계 활용: ▁▂▃▄▅▆▇█
  blocks=[' ','▁','▂','▃','▄','▅','▆','▇','█']
  bars=[]
  for v in vals:
    frac=(v-vmin)/float(vmax-vmin)
    idx=min(8,max(0,int(round(frac*8))))
    bars.append(blocks[idx])
trend=''.join(bars)
# header label + 값 범위
sys.stdout.write(f'{label} [{len(vals)}틱] min={vmin} max={vmax}')
sys.stdout.write('\n'+trend+'\n')
# X축 눈금 (왼쪽=가장오래된 / 오른쪽=가장최신)
if len(vals)>=10:
  ticks_line='├'+'─'*(len(vals)-2)+'┤'
  sys.stdout.write(ticks_line+'\n')
  left_ts=None; right_ts=None
  # ts 값 (0번째 컬럼)
  tss=[r[0] for r in rows[-ticks:]]
  if tss:
    try:
      import datetime
      lt=int(tss[0])//1000; rt=int(tss[-1])//1000
      ld=datetime.datetime.fromtimestamp(lt).strftime('%H:%M')
      rd=datetime.datetime.fromtimestamp(rt).strftime('%H:%M')
      pad=' '*(max(0,len(vals)-len(ld)-len(rd)-4))
      sys.stdout.write(f'│ {ld}{pad}{rd} │\n')
    except Exception: pass
" "$csv" "$col" "$ticks" "$label" 2>/dev/null
}

render_trend_panel() {
  local cols=$1 lines=$2
  local panel_rows=$(( lines - 8 ))
  [ $panel_rows -lt 12 ] && panel_rows=12
  local pad
  pad="$(safe_pad $(( cols - 2 )))"
  printf '%s%*s%s\n' "${BOLD}${C_CYAN}┌─ TREND/추세 ─${C_RST}" "${pad:-0}" "" "${BOLD}${C_CYAN}─┐${C_RST}"
  local trend_title="${C_CYAN}│${C_RST}  ${BOLD}${C_BLUE}후원 건수(추세) · RRA 4단계: 2s(raw 10분) → 1분(12h) → 10분(24h) → 1시간(60일)${C_RST}${C_DIM}저장위치: ${TS_DIR}${C_RST}"
  pad="$(safe_pad_from "$trend_title" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$trend_title" "${pad:-0}" "" "${C_CYAN}│${C_RST}" | cut -c1-"$cols"
  pad="$(safe_pad $(( cols - 2 )))"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"

  local chart_w=$(( cols - 8 ))
  [ $chart_w -lt 20 ] && chart_w=20

  local out="$TMP_DIR/trend_out.txt"
  : > "$out"
  {
    echo "${C_MAGENTA}── donors_n (state 후원 건수 / 실제 엑셀 반영된 건)${C_RST}"
    echo "${C_DIM}[RAW 2s · 최근 10분]${C_RST}"
    ts_ascii_chart "$TS_RAW" "donors_n" "$chart_w" "donors_n·2s"
    echo "${C_DIM}[1분 롤업 · 최근 12시간]${C_RST}"
    ts_ascii_chart "$TS_R1M" "donors_n" "$chart_w" "donors_n·1m"
    echo "${C_DIM}[10분 롤업 · 최근 24시간]${C_RST}"
    ts_ascii_chart "$TS_R10M" "donors_n" "$chart_w" "donors_n·10m"
    echo ""
    echo "${C_CYAN}── donors_sum_won (state 후원 누적금액 추세 · 최고점)${C_RST}"
    ts_ascii_chart "$TS_R1M" "donors_sum_won" "$chart_w" "donors_sum_won·1m"
    ts_ascii_chart "$TS_R10M" "donors_sum_won" "$chart_w" "donors_sum_won·10m"
    echo ""
    echo "${C_YELLOW}── queue_n / unmatch_n (처리 백로그 추세, 0이 정상, 급증은 블로킹 발생 의미)${C_RST}"
    ts_ascii_chart "$TS_RAW" "queue_n" "$chart_w" "QUEUE·2s"
    ts_ascii_chart "$TS_RAW" "unmatch_n" "$chart_w" "UNMATCH·2s"
    echo ""
    echo "${C_GREEN}── hub_ingest_ok (B모드: ingest 1=OK / 0=FAIL / -=측정안됨. 0으로 떨어지면 5xx/폴러 사망)${C_RST}"
    ts_ascii_chart "$TS_RAW" "hub_ingest_ok" "$chart_w" "hub_ingest_OK"
    echo "${C_GREEN}── ws_open (A모드: 1=CONNECTED / 0=설정됐지만 미연결 / -=측정안됨)${C_RST}"
    ts_ascii_chart "$TS_RAW" "ws_open" "$chart_w" "WS_OPEN"
  } > "$out" 2>/dev/null

  local shown=0
  local max_rows=$(( panel_rows - 2 ))
  while IFS= read -r line; do
    shown=$((shown+1))
    [ $shown -gt $max_rows ] && break
    local tl="${C_CYAN}│${C_RST}  $line"
    pad="$(safe_pad_from "$tl" "$(( cols - 4 ))" )"
    printf '%s%*s%s\n' "$tl" "${pad:-0}" "" "${C_CYAN}│${C_RST}" | cut -c1-"$cols"
  done < "$out"
  for ((; shown<=max_rows; shown++)); do
    local bl="${C_CYAN}│ ${C_RST}"
    pad="$(safe_pad_from "$bl" "$(( cols - 4 ))")"
    printf '%s%*s%s\n' "$bl" "${pad:-0}" "" "${C_CYAN}│${C_RST}"
  done

  pad="$(safe_pad $(( cols - 2 )))"
  printf '%s%*s%s\n' "${C_CYAN}└─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┘${C_RST}"
}

# ------------------------------------------------------------------
# DIFF / 후원 숫자 정합성 검사
#   레벨 1: state donors[총 건수/총 금액] vs 허브 logs[최근 1시간 / 24시간] 교차 검증
#   레벨 2: hub logs 상세 id 와 state donors.id 차집합 → 누락 후원 건수/금액
#   레벨 3: QUEUE/UNMATCH 에러 레벨. queue>20 · unmatch>5 면 심각
# ------------------------------------------------------------------
donation_integrity_diff() {
  local out="$1"
  : > "$out" 2>/dev/null || { mkdir -p "$(dirname "$out")" 2>/dev/null; : > "$out" 2>/dev/null; }
  "$PY" -c "
import json,sys,time,os
try:
  state=json.loads(sys.argv[1] or '{}')
except Exception: state={}
try:
  hub=json.loads(sys.argv[2] or '{}')
except Exception: hub={}
q_n=int(sys.argv[3] or 0)
u_n=int(sys.argv[4] or 0)
out_path=sys.argv[5]
def krw(n):
  try: n=int(n)
  except: n=0
  return '₩'+'{:,}'.format(n)
def bail(msg):
  lines=['(정합성 데이터 준비중: '+str(msg)+')','','전체 state donors: 불러오는 중','Hub logs: 불러오는 중']
  try:
    with open(out_path,'w') as f: f.write(chr(10).join(lines)+chr(10))
  except Exception: pass
  sys.exit(0)
try:
  # state donors
  st_donors=state.get('donors') or []
  st_ids=set(); st_sum=0; st_cnt=0
  for d in st_donors:
    try:
      iid=str(d.get('id') or '').strip()
      if not iid: continue
      st_ids.add(iid); st_cnt+=1
      st_sum += int(d.get('amount') or 0)
    except Exception: pass
  # hub logs
  h_logs = hub.get('logs') or hub.get('donationLogs') or []
  now_ms=int(time.time()*1000)
  cutoff_1h=now_ms-3600*1000
  cutoff_24h=now_ms-86400*1000
  h_ids_1h=set(); h_sum_1h=0; h_cnt_1h=0
  h_ids_24h=set(); h_sum_24h=0; h_cnt_24h=0
  def parse_at_to_ms(at):
    if not at: return 0
    if isinstance(at,(int,float)) and at>1e11: return int(at)
    if isinstance(at,(int,float)) and at<1e11: return int(at)*1000
    try:
      from datetime import datetime
      return int(datetime.fromisoformat(str(at).replace('Z','+00:00')).timestamp()*1000)
    except Exception: return 0
  for l in h_logs:
    try:
      amt=int(l.get('amount') or 0); iid=str(l.get('id') or '').strip()
      if amt<=0 or not iid: continue
      ms=parse_at_to_ms(l.get('at') or l.get('ingestedAt'))
      if ms and ms>=cutoff_24h:
        h_ids_24h.add(iid); h_cnt_24h+=1; h_sum_24h+=amt
        if ms>=cutoff_1h:
          h_ids_1h.add(iid); h_cnt_1h+=1; h_sum_1h+=amt
    except Exception: pass
  # state 에 있는 24시간 이내 후원 id
  st_ids_24h=set(); st_sum_24h=0; st_cnt_24h=0
  st_ids_1h=set(); st_sum_1h=0; st_cnt_1h=0
  for d in st_donors:
    try:
      iid=str(d.get('id') or '').strip()
      if not iid: continue
      amt=int(d.get('amount') or 0)
      at=parse_at_to_ms(d.get('at'))
      if at and at>=cutoff_24h:
        st_ids_24h.add(iid); st_cnt_24h+=1; st_sum_24h+=amt
        if at>=cutoff_1h:
          st_ids_1h.add(iid); st_cnt_1h+=1; st_sum_1h+=amt
    except Exception: pass
  missing_ids_1h = sorted(list(h_ids_1h - st_ids_1h))[:20]
  missing_ids_24h = sorted(list(h_ids_24h - st_ids_24h))[:20]
  excess_ids = sorted(list(st_ids_24h - h_ids_24h))[:20]
  missing_ids_1h_sum=0
  missing_ids_24h_sum=0
  id_to_amt_h24={}
  for l in h_logs:
    try:
      iid=str(l.get('id') or '').strip()
      if not iid: continue
      ms=parse_at_to_ms(l.get('at') or l.get('ingestedAt'))
      if ms and ms>=cutoff_24h:
        id_to_amt_h24[iid]=int(l.get('amount') or 0)
    except Exception: pass
  for iid in missing_ids_1h: missing_ids_1h_sum += id_to_amt_h24.get(iid,0)
  for iid in missing_ids_24h: missing_ids_24h_sum += id_to_amt_h24.get(iid,0)
  warnings=[]; level='OK'
  if q_n>=100 or u_n>=50:
    level='CRITICAL'
    warnings.append(f'백로그 과다: QUEUE {q_n}건 / UNMATCH {u_n}건')
  elif q_n>=20 or u_n>=10:
    if level!='CRITICAL': level='WARN'
    warnings.append(f'백로그 주의: QUEUE {q_n}건 / UNMATCH {u_n}건')
  if len(missing_ids_24h)>=10 or missing_ids_24h_sum>=500000:
    if level!='CRITICAL': level='CRITICAL'
    warnings.append(f'24h 허브→state 누락: {len(h_ids_24h-st_ids_24h)}건 / {krw(missing_ids_24h_sum)}')
  elif len(missing_ids_24h)>=3 or missing_ids_24h_sum>=50000:
    if level not in ('CRITICAL','WARN'): level='WARN'
    warnings.append(f'24h 허브→state 경미 누락: {len(h_ids_24h-st_ids_24h)}건 / {krw(missing_ids_24h_sum)}')
  if len(excess_ids)>=20:
    if level!='CRITICAL': level='CRITICAL' if level=='OK' else level
    warnings.append(f'state 에만 있는 24h 이내 후원 과다(중복 삽입?): {len(excess_ids)}건')
  lines=[]
  lv_color={'OK':'\033[32m','WARN':'\033[33m','CRITICAL':'\033[31m'}.get(level,'\033[37m')
  lines.append(f'통합 정합성 레벨: {lv_color}{level}\033[0m' + (f'   {len(warnings)}건' if warnings else ''))
  lines.append('')
  lines.append(f'  전체 state donors:       {st_cnt:>8}건 / 총 {krw(st_sum)}')
  lines.append(f'')
  lines.append(f'  ┌─ 최근 1시간 교차 검증')
  lines.append(f'  │ Hub logs     : {h_cnt_1h:>6}건 / {krw(h_sum_1h)}')
  lines.append(f'  │ State donors : {st_cnt_1h:>6}건 / {krw(st_sum_1h)}')
  lines.append(f'  │ Diff(Hub-St) : {len(h_ids_1h-st_ids_1h):>+6}건 / {krw(h_sum_1h-st_sum_1h)}')
  lines.append(f'  │ Hub→State 미반영(missing) : {len(h_ids_1h-st_ids_1h)}건 / {krw(missing_ids_1h_sum)}' + (f' ({", ".join(missing_ids_1h[:5])})' if missing_ids_1h else ''))
  lines.append(f'  └ State→Hub 초과(excess)   : {len(st_ids_1h-h_ids_1h)}건')
  lines.append(f'')
  lines.append(f'  ┌─ 최근 24시간 교차 검증')
  lines.append(f'  │ Hub logs     : {h_cnt_24h:>6}건 / {krw(h_sum_24h)}')
  lines.append(f'  │ State donors : {st_cnt_24h:>6}건 / {krw(st_sum_24h)}')
  lines.append(f'  │ Diff(Hub-St) : {len(h_ids_24h-st_ids_24h):>+6}건 / {krw(h_sum_24h-st_sum_24h)}')
  lines.append(f'  │ Hub→State 미반영(missing) Top5: {len(h_ids_24h-st_ids_24h)}건 / {krw(missing_ids_24h_sum)}' + (f' → id 샘플: {", ".join(missing_ids_24h[:5])}' if missing_ids_24h else ' (clean!)'))
  lines.append(f'  └ State→Hub 초과(excess) Top5  : {len(excess_ids)}건' + (f' → 샘플: {", ".join(excess_ids[:5])}' if excess_ids else ''))
  lines.append(f'')
  lines.append(f'  처리 백로그 QUEUE={q_n}  UNMATCH={u_n}')
  if warnings:
    lines.append('')
    lines.append('경고 상세:')
    for w in warnings: lines.append(f'   {w}')
  with open(out_path,'w') as f:
    f.write('\n'.join(lines)+'\n')
except Exception as e:
  bail(str(e))
" "$(printf '%s' "$SNAP_STATE_JSON" | cut -c1-200000)" "$(printf '%s' "$SNAP_HUB_JSON" | cut -c1-200000)" "${q_len:-0}" "${un_len:-0}" "$out" 2>/dev/null
  if [ ! -s "$out" ]; then
    {
      echo "(정합성 데이터 준비중...)"
      echo ""
      echo "  후원 state / hub logs 를 아직 불러오지 못했습니다."
      echo "  잠시 후 자동으로 갱신됩니다."
    } > "$out" 2>/dev/null
  fi
}

render_diff_panel() {
  local cols=$1 lines=$2
  local panel_rows=$(( lines - 8 ))
  [ $panel_rows -lt 12 ] && panel_rows=12
  local pad
  pad="$(safe_pad $(( cols - 2 )))"
  printf '%s%*s%s\n' "${BOLD}${C_CYAN}┌─ DIFF/정합성 ─${C_RST}" "${pad:-0}" "" "${BOLD}${C_CYAN}─┐${C_RST}"
  local diff_title="${C_CYAN}│${C_RST}  ${BOLD}${C_MAGENTA}후원 숫자 교차 검증 · Hub logs <-> state donors (최근 1h / 24h)${C_RST}"
  pad="$(safe_pad_from "$diff_title" "$(( cols - 4 ))" )"
  printf '%s%*s%s\n' "$diff_title" "${pad:-0}" "" "${C_CYAN}│${C_RST}" | cut -c1-"$cols"
  pad="$(safe_pad $(( cols - 2 )))"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"

  local diff_out="$TMP_DIR/diff.txt"
  mkdir -p "$TMP_DIR" 2>/dev/null
  donation_integrity_diff "$diff_out"
  if [ ! -r "$diff_out" ]; then
    {
      echo "(정합성 데이터 준비중...)"
      echo ""
      echo "  후원 state / hub logs 를 아직 불러오지 못했습니다."
      echo "  잠시 후 자동으로 갱신됩니다."
    } > "$diff_out" 2>/dev/null
  fi
  local shown=0 max_rows=$(( panel_rows - 2 ))
  while IFS= read -r line || [ -n "$line" ]; do
    shown=$((shown+1))
    [ $shown -gt $max_rows ] && break
    local dline="${C_CYAN}│${C_RST}  $line"
    pad="$(safe_pad_from "$dline" "$(( cols - 4 ))" )"
    printf '%s%*s%s\n' "$dline" "${pad:-0}" "" "${C_CYAN}│${C_RST}" | cut -c1-"$cols"
  done < "$diff_out"
  for ((; shown<=max_rows; shown++)); do
    local bl="${C_CYAN}│ ${C_RST}"
    pad="$(safe_pad_from "$bl" "$(( cols - 4 ))")"
    printf '%s%*s%s\n' "$bl" "${pad:-0}" "" "${C_CYAN}│${C_RST}"
  done
  pad="$(safe_pad $(( cols - 2 )))"
  printf '%s%*s%s\n' "${C_CYAN}└─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┘${C_RST}"
}

if [ "$MODE_ONCE" = "1" ]; then
  collect_snapshot
  ts_collect_now
  render_ui
  exit 0
fi

if [ ! -t 0 ]; then
  echo "Warning: TTY가 아니라서 TUI 입력이 안됩니다. MODE=once 로 1회 덤프를 사용하세요." >&2
  MODE_ONCE=1
  collect_snapshot
  ts_collect_now
  render_ui
  exit 0
fi

stty -echo 2>/dev/null
printf '\033[?25l'

exec 2>/dev/null

SHOW_HELP=0
VIEW="ui"  # ui | trend | diff
while true; do
  collect_snapshot
  ts_collect_now
  # 프레임 버퍼링: 모든 render 출력을 단일 파일에 모은 뒤 1번에 cat → stdout syscall 1/40로 감소 & 브라우저 DOM 리렌더 횟수 급감
  : > "$FRAME_BUF"
  if [ "$SHOW_HELP" = "1" ]; then
    render_help >> "$FRAME_BUF" 2>/dev/null
    SHOW_HELP=0
  else
    case "$VIEW" in
      ui)    render_ui >> "$FRAME_BUF" 2>/dev/null ;;
      trend)
        cols=$(tput cols 2>/dev/null || echo 120)
        lines=$(tput lines 2>/dev/null || echo 40)
        [ -z "$cols" ] && cols=120
        [ -z "$lines" ] && lines=40
        render_trend_panel "$cols" "$lines" >> "$FRAME_BUF" 2>/dev/null
        ;;
      diff)
        cols=$(tput cols 2>/dev/null || echo 120)
        lines=$(tput lines 2>/dev/null || echo 40)
        [ -z "$cols" ] && cols=120
        [ -z "$lines" ] && lines=40
        render_diff_panel "$cols" "$lines" >> "$FRAME_BUF" 2>/dev/null
        ;;
      *) render_ui >> "$FRAME_BUF" 2>/dev/null ;;
    esac
  fi
  # 프레임 Flush: 커서 홈 이동 → 단일 cat → 터미널 write 1회 + erase display J 안써서 DOM 깜빡임 최소화
  printf '\033[H'
  cat "$FRAME_BUF" 2>/dev/null || true

  read_cmd=""
  IFS= read -r -s -n 1 -t "$((REFRESH_MS/1000)).$(( (REFRESH_MS%1000)/100 ))" read_cmd 2>/dev/null || read_cmd=""
  case "$read_cmd" in
    q|Q) break ;;
    r|R) continue ;;
    h|H) SHOW_HELP=1 ;;
    t|T) VIEW="trend" ; continue ;;
    d|D) VIEW="diff"  ; continue ;;
    v|V|s|S) VIEW="ui"       ; continue ;;
    "") ;;
    *) ;;
  esac
done

exit 0
