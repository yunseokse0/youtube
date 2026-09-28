#!/usr/bin/env bash
# DIN Studio v6 · EC2 실시간 후원 모니터링 TUI (ec2-donation-monitor.sh)
#
# 사용법:
#   bash deploy/ec2-donation-monitor.sh            # 기본 대상 유저 finalent · 로컬 3000 포트
#   TARGET_USER=testuser123 PORT=4000 bash deploy/ec2-donation-monitor.sh
#   MODE=once NO_COLOR=1 bash deploy/ec2-donation-monitor.sh   # 1회 덤프 + 파이프 가능
#   COOKIE='sb_user=<value>; Path=/' TARGET_USER=finalent bash deploy/ec2-donation-monitor.sh
#
# 부하테스트 감시:
#   정산표 = state.donors 전체 (엑셀 반영). 허브버퍼 = 최근 ingest 일부.
#   누락   = 허브 id 가 정산표에 없는 경우만. 허브 건수 < 정산표 는 정상.
# 핫키 (TUI 모드):
#   [r]   즉시 새로고침
#   [d]   누락 상세
#   [t]   추세
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

MONITOR_DIR="$(cd "$(dirname "$0")" && pwd)"
INTEGRITY_PY="${MONITOR_DIR}/ec2-donation-integrity.py"
LOADTEST_PY="${MONITOR_DIR}/ec2-donation-loadtest-summary.py"
LOADTEST_JSON=""
LT_BASE_N=""
LT_BASE_SUM=""
LT_BASE_TS=""
LT_BASE_SET=""

curl_get() {
  local url="$1"
  local dest="${2:-}"
  local t="${3:-8}"
  local -a args
  args=(-s --max-time "$t" --connect-timeout 3 --retry 2 --retry-delay 1 --retry-all-errors)
  if [ -n "$COOKIE" ]; then
    args+=(-b "$COOKIE")
  fi
  if [ -n "$dest" ]; then
    curl "${args[@]}" "$url" -o "$dest" 2>/dev/null
  else
    curl "${args[@]}" "$url" 2>/dev/null
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
  local py='
import json,sys
path=sys.argv[3] if len(sys.argv)>3 else ""
try:
  raw=open(path,encoding="utf-8",errors="replace").read() if path else (sys.stdin.read() or "{}")
  d=json.loads(raw or "{}")
except Exception:
  sys.exit(0)
try:
  arr=eval(sys.argv[1].replace("/", "."), {"__builtins__": {}}, {"d": d})
except Exception:
  sys.exit(0)
if not isinstance(arr, list):
  sys.exit(0)
limit=int(sys.argv[2])
rows=[]
for x in arr[-limit:]:
  if not isinstance(x, dict):
    continue
  at=str(x.get("at") or x.get("ingestedAt") or "")
  if at and at.endswith("Z"):
    try:
      import datetime
      dt=datetime.datetime.fromisoformat(at.replace("Z", "+00:00"))
      dt_kr=dt.astimezone(datetime.timezone(datetime.timedelta(hours=9)))
      at=dt_kr.strftime("%m-%d %H:%M:%S")
    except Exception:
      pass
  elif at and len(at) >= 19:
    at=at[5:10] + " " + at[11:19]
  name=str(x.get("name") or x.get("donorName") or x.get("donor") or "?")[:14]
  amt=x.get("amount") or 0
  try:
    amt=int(amt)
  except Exception:
    amt=0
  target=str(x.get("target") or "")
  target_short={"account":"계좌","toon":"툰","toonation":"투네","bank":"계좌"}.get(target, target[:4] if target else "")
  msg=str(x.get("message") or "").replace("\n"," ").replace("\r"," ")[:28]
  src_tag=""
  if x.get("provider")=="toonation" or x.get("source")=="ws":
    src_tag="WS"
  elif x.get("provider")=="bank" or x.get("source")=="ingest":
    src_tag="HB"
  elif x.get("source")=="toona":
    src_tag="HB"
  if src_tag:
    src_tag="[" + src_tag + "]"
  amt_s="₩" + "{:>10,}".format(amt)
  rows.append(f"{at} {src_tag:<4} {name:<14} {amt_s} {target_short:<3} {msg}")
for r in reversed(rows):
  print(r)
'
  if [ -f "$src" ]; then
    "$PY" -c "$py" "$expr" "$limit" "$src"
  else
    "$PY" -c "$py" "$expr" "$limit" "" <<< "$src"
  fi
}

# 한글 깨짐 방지: cut -c 로 자르지 않고 줄만 출력한다.
ui_row() {
  printf '%s\n' "${C_CYAN}│${C_RST} $1"
}

lt_get() {
  local key="$1"
  local def="${2:-}"
  if [ ! -s "${LOADTEST_JSON:-}" ]; then
    printf '%s' "$def"
    return
  fi
  "$PY" -c '
import json,sys
try:
  d=json.loads(open(sys.argv[1],encoding="utf-8").read())
except Exception:
  d={}
k=sys.argv[2]
v=d.get(k)
if v is None:
  sys.stdout.write(sys.argv[3])
elif isinstance(v, list):
  sys.stdout.write(",".join(str(x) for x in v[:8]))
else:
  sys.stdout.write(str(v))
' "$LOADTEST_JSON" "$key" "$def"
}

collect_snapshot() {
  local mode_url="${BASE_URL}/api/settings/intake-mode?u=${TARGET_USER}"
  local listener_url="${BASE_URL}/api/donations/toonation/listener?u=${TARGET_USER}"
  local hub_url="${BASE_URL}/api/toona/hub?u=${TARGET_USER}"
  local queue_url="${BASE_URL}/api/donations/queue?u=${TARGET_USER}"
  local unmatched_url="${BASE_URL}/api/donations/unmatched?u=${TARGET_USER}"
  local state_url="${BASE_URL}/api/state?u=${TARGET_USER}"
  local pm2_log_url="${BASE_URL}/api/health"

  SNAP_STATE_FILE="$TMP_DIR/snap_state.json"
  SNAP_HUB_FILE="$TMP_DIR/snap_hub.json"
  SNAP_MODE_JSON="$(curl_get "$mode_url")"
  SNAP_WS_JSON="$(curl_get "$listener_url")"
  SNAP_QUEUE_JSON="$(curl_get "$queue_url")"
  SNAP_UNMATCH_JSON="$(curl_get "$unmatched_url")"
  SNAP_HEALTH_JSON="$(curl_get "$pm2_log_url")"
  # 3MB+ state 를 500KB로 자르면 JSON이 깨져 정합성이 Python rc=1 로 빈다
  curl_get "$state_url" "$SNAP_STATE_FILE" 45
  curl_get "$hub_url" "$SNAP_HUB_FILE" 15
  # 큰 state 를 bash 변수에 cat 하면 here-string 이 잘려 건수=0 으로 추세가 빈다. 허브만 변수로 둔다.
  SNAP_STATE_JSON=""
  SNAP_HUB_JSON="$(cat "$SNAP_HUB_FILE" 2>/dev/null || true)"
  STATE_BYTES=$(wc -c < "$SNAP_STATE_FILE" 2>/dev/null)
  HUB_BYTES=$(wc -c   < "$SNAP_HUB_FILE"   2>/dev/null)
  [[ "$STATE_BYTES" =~ ^[0-9]+$ ]] || STATE_BYTES=0
  [[ "$HUB_BYTES"   =~ ^[0-9]+$ ]] || HUB_BYTES=0
  local _st
  _st=$("$PY" -c '
import json,sys
try:
  d=json.loads(open(sys.argv[1],encoding="utf-8",errors="replace").read() or "{}")
except Exception:
  print("0 0"); raise SystemExit(0)
arr=d.get("donors")
if not isinstance(arr,list):
  print("0 0"); raise SystemExit(0)
s=0
for x in arr:
  if not isinstance(x,dict):
    continue
  try:
    s += int(x.get("amount") or 0)
  except Exception:
    pass
print(len(arr), s)
' "$SNAP_STATE_FILE" 2>/dev/null)
  DONORS_N=$(printf '%s' "$_st" | awk '{print $1}')
  DONORS_SUM=$(printf '%s' "$_st" | awk '{print $2}')
  [[ "$DONORS_N" =~ ^[0-9]+$ ]] || DONORS_N=0
  [[ "$DONORS_SUM" =~ ^-?[0-9]+$ ]] || DONORS_SUM=0
  DBG_DONORS_N="$DONORS_N"
  DBG_HUBLOG_N=$("$PY" -c '
import json,sys
try:
  d=json.loads(open(sys.argv[1],encoding="utf-8",errors="replace").read() or "{}")
  logs=d.get("logs") or d.get("donationLogs")
  if isinstance(logs,list): print(len(logs))
  else: print(0)
except Exception:
  print(0)
' "$SNAP_HUB_FILE" 2>/dev/null)
  [[ "$DBG_HUBLOG_N" =~ ^[0-9]+$ ]] || DBG_HUBLOG_N=0
  Q_LEN=$(json_field_str "$SNAP_QUEUE_JSON" 'len(d.get("items") or [])' '0')
  UN_LEN=$(json_field_str "$SNAP_UNMATCH_JSON" 'len(d.get("items") or [])' '0')
  [[ "$Q_LEN" =~ ^[0-9]+$ ]] || Q_LEN=0
  [[ "$UN_LEN" =~ ^[0-9]+$ ]] || UN_LEN=0
  WS_OPEN=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("wsConnected")' '')
  WS_COUNT=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("receivedCount")' '0')
  HUB_INGEST_OK=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("lastIngestOk")' '')
  HUB_INGEST_AT=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("lastIngestAt")' '')
  HUB_STATUS_OK=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("lastStatusOk")' '')
  HUB_LOG_N="$DBG_HUBLOG_N"
  LOADTEST_JSON="$TMP_DIR/loadtest.json"
  if [ -f "$LOADTEST_PY" ]; then
    "$PY" "$LOADTEST_PY" "$SNAP_STATE_FILE" "$SNAP_HUB_FILE" "${Q_LEN:-0}" "${UN_LEN:-0}" "$LOADTEST_JSON" 2>/dev/null || true
  fi
  if [ -z "${LT_BASE_SET:-}" ]; then
    _lv="$(lt_get verdict STATE_FAIL)"
    if [ "$_lv" != "STATE_FAIL" ]; then
      LT_BASE_N="${DONORS_N:-0}"
      LT_BASE_SUM="${DONORS_SUM:-0}"
      LT_BASE_TS="$(date +%s)"
      LT_BASE_SET=1
    fi
  fi
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

  local now
  now=$(date '+%Y-%m-%d %H:%M:%S %Z')

  local mode_ok short mode_val desc
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
      mode_label="${C_YELLOW}${BOLD}${mode_val} 모드${C_RST}"
    fi
  else
    mode_label="${C_RED}${BOLD}모드 조회실패${C_RST}"
  fi

  local ws_enabled ws_open ws_last_rx ws_count
  ws_enabled=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("enabled")' '')
  ws_open=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("wsConnected")' '')
  ws_last_rx=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("lastMessageAt")' '')
  ws_count=$(json_field_str "$SNAP_WS_JSON" 'd.get("status",{}).get("receivedCount")' '0')
  if [ "$ws_open" = "true" ]; then
    ws_pill="${C_GREEN}● WS 연결${C_RST}"
  elif [ "$ws_enabled" = "true" ]; then
    ws_pill="${C_YELLOW}⚠ WS 미연결${C_RST}"
  else
    ws_pill="${C_DIM}○ WS off${C_RST}"
  fi

  local hub_ok hub_email hub_last_ingest_at hub_last_ingest_ok hub_log_n hub_pill
  hub_ok=$(json_field_str "$SNAP_HUB_JSON" 'd.get("ok")' '')
  hub_email=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("email")' '')
  hub_last_ingest_at=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("lastIngestAt")' '')
  hub_last_ingest_ok=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("lastIngestOk")' '')
  hub_log_n=$(json_field_str "$SNAP_HUB_JSON" 'len(d.get("logs") or [])' '0')
  if [ "$hub_ok" = "true" ]; then
    if [ -n "$hub_email" ] && [ "$hub_email" != "null" ]; then
      if [ "$hub_last_ingest_ok" = "true" ]; then
        hub_pill="${C_GREEN}● ingest OK${C_RST} $(fmt_ago "$hub_last_ingest_at")"
      elif [ "$hub_last_ingest_ok" = "false" ]; then
        hub_pill="${C_RED}✖ ingest FAIL${C_RST} $(fmt_ago "$hub_last_ingest_at")"
      else
        hub_pill="${C_YELLOW}◐ ingest 대기${C_RST}"
      fi
    else
      hub_pill="${C_YELLOW}⚠ 허브 미로그인 (COOKIE 필요)${C_RST}"
    fi
  else
    hub_pill="${C_RED}✖ 허브 API 거부${C_RST}"
  fi

  local q_len un_len
  q_len="${Q_LEN:-0}"
  un_len="${UN_LEN:-0}"
  [[ "$q_len" =~ ^[0-9]+$ ]] || q_len=0
  [[ "$un_len" =~ ^[0-9]+$ ]] || un_len=0

  local donors_n donors_sum
  donors_n="${DONORS_N:-0}"
  donors_sum="${DONORS_SUM:-0}"
  [[ "$donors_n" =~ ^[0-9]+$ ]] || donors_n=0
  [[ "$donors_sum" =~ ^-?[0-9]+$ ]] || donors_sum=0

  local lt_verdict lt_ko lt_miss_n lt_miss_sum lt_hub_n lt_state_n miss_ids
  lt_verdict="$(lt_get verdict OK)"
  lt_ko="$(lt_get verdict_ko '누락 없음')"
  lt_miss_n="$(lt_get missing_n 0)"
  lt_miss_sum="$(lt_get missing_sum 0)"
  lt_hub_n="$(lt_get hub_n "${HUB_LOG_N:-0}")"
  lt_state_n="$(lt_get state_n "$donors_n")"
  miss_ids="$(lt_get missing_ids "")"
  [[ "$lt_miss_n" =~ ^[0-9]+$ ]] || lt_miss_n=0
  [[ "$lt_miss_sum" =~ ^-?[0-9]+$ ]] || lt_miss_sum=0
  [[ "$lt_hub_n" =~ ^[0-9]+$ ]] || lt_hub_n=0
  [[ "$lt_state_n" =~ ^[0-9]+$ ]] || lt_state_n="$donors_n"

  local verdict_pill
  if [ "$lt_verdict" = "OK" ]; then
    verdict_pill="${C_GREEN}${BOLD}판정  OK${C_RST}   ${C_GREEN}누락 ${lt_miss_n}건${C_RST}  · ${lt_ko}"
  elif [ "$lt_verdict" = "MISSING" ]; then
    verdict_pill="${C_RED}${BOLD}판정  MISSING${C_RST}   ${C_RED}누락 ${lt_miss_n}건 $(fmt_krw "$lt_miss_sum")${C_RST}  · ${lt_ko}"
  elif [ "$lt_verdict" = "BACKLOG" ]; then
    verdict_pill="${C_YELLOW}${BOLD}판정  BACKLOG${C_RST}   누락 ${lt_miss_n}건  · ${lt_ko}"
  else
    verdict_pill="${C_RED}${BOLD}판정  ${lt_verdict}${C_RST}   · ${lt_ko}"
  fi

  local base_n="${LT_BASE_N:-0}"
  local base_sum="${LT_BASE_SUM:-0}"
  [[ "$base_n" =~ ^[0-9]+$ ]] || base_n=0
  [[ "$base_sum" =~ ^-?[0-9]+$ ]] || base_sum=0
  local delta_n=$(( donors_n - base_n ))
  local delta_sum=$(( donors_sum - base_sum ))
  local delta_n_s delta_sum_s
  if [ "$delta_n" -ge 0 ]; then delta_n_s="+${delta_n}"; else delta_n_s="${delta_n}"; fi
  if [ "$delta_sum" -ge 0 ]; then delta_sum_s="+$(fmt_krw "$delta_sum")"; else delta_sum_s="$(fmt_krw "$delta_sum")"; fi
  local now_s elapsed_s elapsed_h
  now_s=$(date +%s)
  elapsed_s=$(( now_s - ${LT_BASE_TS:-$now_s} ))
  if [ "$elapsed_s" -lt 0 ]; then elapsed_s=0; fi
  if [ "$elapsed_s" -lt 60 ]; then
    elapsed_h="${elapsed_s}초"
  elif [ "$elapsed_s" -lt 3600 ]; then
    elapsed_h="$((elapsed_s/60))분"
  else
    elapsed_h="$((elapsed_s/3600))시간$(( (elapsed_s%3600)/60 ))분"
  fi

  local hub_logs_tmp="$TMP_DIR/hub_logs.txt"
  json_list_tail_donors "$SNAP_HUB_FILE" 'd.get("logs") or d.get("donationLogs") or []' 40 > "$hub_logs_tmp"

  pad="$(safe_pad $((cols - 2)))"
  printf '%s%*s%s\n' "${BOLD}${C_CYAN}┌─ 부하테스트 감시${C_RST}" "${pad:-0}" "" "${BOLD}${C_CYAN}─┐${C_RST}"
  ui_row "${BOLD}TARGET=${TARGET_USER}${C_RST}  ${BASE_URL}  ${C_DIM}$((REFRESH_MS/1000))s · ${now}${C_RST}"
  ui_row "${mode_label}${C_DIM}  ${short} ${desc}${C_RST}"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"

  ui_row "$verdict_pill"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"

  ui_row "${BOLD}정산표${C_RST}  엑셀에 반영된 전체     ${BOLD}${lt_state_n}${C_RST}건  $(fmt_krw "$donors_sum")"
  if [ "${LT_BASE_SET:-}" = "1" ]; then
    ui_row "${BOLD}세션증가${C_RST}  기준 잡힌 뒤 ${elapsed_h}   ${C_GREEN}${delta_n_s}건${C_RST}  ${delta_sum_s}"
  else
    ui_row "${BOLD}세션증가${C_RST}  ${C_DIM}정산표 로딩 후 시작${C_RST}"
  fi
  ui_row "${BOLD}허브버퍼${C_RST}  최근 ingest 일부만    ${lt_hub_n}건   ${C_DIM}← 정산표보다 적어도 정상. 이 숫자로 누락 판단 금지${C_RST}"
  ui_row "${BOLD}누락${C_RST}     허브에 있고 정산표에 없음  ${BOLD}${lt_miss_n}${C_RST}건  $(fmt_krw "$lt_miss_sum")"
  if [ "$lt_miss_n" -gt 0 ] && [ -n "$miss_ids" ]; then
    ui_row "         ${C_RED}id: ${miss_ids}${C_RST}  ${C_DIM}(d 키로 전체)${C_RST}"
  fi
  ui_row "${BOLD}대기${C_RST}     QUEUE ${q_len}   UNMATCH ${un_len}   ${C_DIM}(엑셀 반영 전. 누락이 아님)${C_RST}"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"

  ui_row "[A] ${ws_pill}  수신 ${ws_count}건  $(fmt_ago "$ws_last_rx")     [B] ${hub_pill}  ${hub_email:-no-login}"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"

  local log_rows=$(( lines - 18 ))
  [ $log_rows -lt 4 ] && log_rows=4
  ui_row "${BOLD}최근 허브 수신${C_RST} ${C_DIM}(버퍼만. 정산표 전체가 아님)  [q종료 r새로고침 d누락상세 t추세 h도움]${C_RST}"

  local shown=0
  if [ -s "$hub_logs_tmp" ]; then
    while IFS= read -r line; do
      shown=$((shown+1))
      ui_row "  ${C_DIM}·${C_RST} $line"
    done < <(awk 'NF && !seen[$0]++' "$hub_logs_tmp" 2>/dev/null | head -n "$log_rows")
  else
    ui_row "  ${C_DIM}(허브 버퍼 비어 있음. 정산표 ${lt_state_n}건은 위에 있음)${C_RST}"
    shown=1
  fi
  for ((; shown<log_rows; shown++)); do
    ui_row ""
  done

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
  echo "    ${BOLD}r${C_RST}         즉시 새로고침"
  echo "    ${BOLD}d${C_RST}         누락 상세 (허브 id 가 정산표에 없는 것만)"
  echo "    ${BOLD}t${C_RST}         추세"
  echo "    ${BOLD}h${C_RST}         이 도움말"
  echo ""
  echo "  ${BOLD}${C_YELLOW}숫자를 이렇게 읽으세요 (부하테스트):${C_RST}"
  echo "    판정 OK        · 허브에 있는 후원이 전부 정산표에 있음"
  echo "    판정 MISSING   · 허브 id 가 정산표(state.donors)에 없음 = 진짜 누락"
  echo "    정산표         · 엑셀에 반영된 전체 후원. 이게 진짜 건수"
  echo "    허브버퍼       · 최근 ingest 일부. 정산표보다 적어도 정상. 비교하지 말 것"
  echo "    세션증가       · 이 모니터를 켠 뒤 정산표가 늘어난 건수"
  echo "    QUEUE/UNMATCH  · 아직 엑셀 반영 전. 누락이 아님"
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
  echo "  ${BOLD}${C_YELLOW}트러블슈팅 팁:${C_RST}"
  echo "    ① /api/toona/hub 응답이 'unauthorized' → 관리자 페이지 로그인 후 sb_user 쿠키를 COOKIE= 로 넘기세요."
  echo "    ② B 모드인데 ingest FAIL → \`pm2 logs youtube --lines 200 --nostream\` 에서 poller 확인."
  echo "    ③ 정산표 0건인데 관리자 화면엔 있으면 → state curl 실패. DEBUG/STATE_BYTES 확인."
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
  donors_n_v="${DONORS_N:-0}"
  donors_sum_v="${DONORS_SUM:-0}"
  q_v="${Q_LEN:-0}"
  un_v="${UN_LEN:-0}"
  [ "${WS_OPEN:-}" = "true" ] && wsopen_v=1 || [ "${WS_OPEN:-}" = "false" ] && wsopen_v=0 || wsopen_v="-"
  wsrx_v="${WS_COUNT:-0}"
  [ "${HUB_INGEST_OK:-}" = "true" ] && hok_v=1 || [ "${HUB_INGEST_OK:-}" = "false" ] && hok_v=0 || hok_v="-"
  if [[ "${HUB_INGEST_AT:-}" =~ ^[0-9]+$ ]]; then
    hago_s=$(( (ts_ms - HUB_INGEST_AT) / 1000 ))
    [ "$hago_s" -lt 0 ] && hago_s=0
    hago_s_v="$hago_s"
  else
    hago_s_v="-"
  fi
  [ "${HUB_STATUS_OK:-}" = "true" ] && hsok_v=1 || [ "${HUB_STATUS_OK:-}" = "false" ] && hsok_v=0 || hsok_v="-"
  hlogn_v="${HUB_LOG_N:-0}"

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
# bash double-quoted python -c 안의 ", ".join 이 문자열을 끊어서 SyntaxError(rc=1)가 난다.
# 스크립트 파일 또는 quoted heredoc 만 사용한다.
donation_integrity_run_py() {
  local out="$1"
  if [ -f "$INTEGRITY_PY" ]; then
    "$PY" "$INTEGRITY_PY" "$SNAP_STATE_FILE" "$SNAP_HUB_FILE" "${q_len:-0}" "${un_len:-0}" "$out"
    return $?
  fi
  "$PY" - "$SNAP_STATE_FILE" "$SNAP_HUB_FILE" "${q_len:-0}" "${un_len:-0}" "$out" <<'PY'
import json, sys, time
from datetime import datetime, timezone

def krw(n):
    try:
        n = int(n)
    except (TypeError, ValueError):
        n = 0
    return "₩{:,}".format(n)

def parse_at(at):
    if not at:
        return 0
    if isinstance(at, (int, float)):
        at = int(at)
        return at if at > 1e11 else at * 1000
    try:
        return int(datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return 0

def load(p):
    try:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            return json.loads(f.read() or "{}")
    except Exception as e:
        return {"_err": str(e)}

state_file, hub_file, q_s, u_s, out_path = sys.argv[1:6]
q_n = int(q_s or 0)
u_n = int(u_s or 0)
state = load(state_file)
hub = load(hub_file)
lines = []
if state.get("_err"):
    lines.append("state 파싱 실패: " + state["_err"])
if hub.get("_err"):
    lines.append("hub 파싱 실패: " + hub["_err"])
donors = state.get("donors") if isinstance(state.get("donors"), list) else []
logs = hub.get("logs") or hub.get("donationLogs") or []
if not isinstance(logs, list):
    logs = []
reset_at = int(state.get("settlementResetAt") or 0)
st_sum = 0
st_ids = set()
st_cnt_1h = 0
st_sum_1h = 0
st_ids_1h = set()
st_cnt_24h = 0
st_sum_24h = 0
st_ids_24h = set()
st_cnt_post = 0
st_sum_post = 0
now = int(time.time() * 1000)
c1 = now - 3600 * 1000
c24 = now - 86400 * 1000
for d in donors:
    if not isinstance(d, dict):
        continue
    iid = str(d.get("id") or "").strip()
    if not iid:
        continue
    amt = int(d.get("amount") or 0)
    st_ids.add(iid)
    st_sum += amt
    at = parse_at(d.get("at"))
    if at >= c24:
        st_ids_24h.add(iid)
        st_cnt_24h += 1
        st_sum_24h += amt
        if at >= c1:
            st_ids_1h.add(iid)
            st_cnt_1h += 1
            st_sum_1h += amt
    if reset_at <= 0 or at == 0 or at >= reset_at:
        st_cnt_post += 1
        st_sum_post += amt
sess = hub.get("session") if isinstance(hub.get("session"), dict) else {}
email = str((sess or {}).get("email") or "").strip()
h_ids_1h = set()
h_sum_1h = 0
h_cnt_1h = 0
h_ids_24h = set()
h_sum_24h = 0
h_cnt_24h = 0
for log in logs:
    if not isinstance(log, dict):
        continue
    amt = int(log.get("amount") or 0)
    iid = str(log.get("id") or "").strip()
    if amt <= 0 or not iid:
        continue
    ms = parse_at(log.get("at") or log.get("ingestedAt"))
    if ms >= c24:
        h_ids_24h.add(iid)
        h_cnt_24h += 1
        h_sum_24h += amt
        if ms >= c1:
            h_ids_1h.add(iid)
            h_cnt_1h += 1
            h_sum_1h += amt
miss_1h = sorted(h_ids_1h - st_ids_1h)
miss_24h = sorted(h_ids_24h - st_ids_24h)
level = "OK"
if q_n >= 20 or u_n >= 10:
    level = "WARN"
if q_n >= 100 or u_n >= 50:
    level = "CRITICAL"
if len(logs) == 0:
    level = "WARN"
lines += [
    "통합 정합성 레벨: " + level,
    "",
    "  전체 state donors:       {:>8}건 / 총 {}".format(len(st_ids), krw(st_sum)),
]
if reset_at > 0:
    try:
        rs = datetime.fromtimestamp(reset_at / 1000, tz=timezone.utc).astimezone().strftime("%m-%d %H:%M")
    except Exception:
        rs = str(reset_at)
    lines.append("  정산 리셋 시점:           " + rs)
    lines.append("   └─ 리셋 이후 POST     : {:>8}건 / 총 {}".format(st_cnt_post, krw(st_sum_post)))
if email:
    lines.append("  Hub session email:      " + email)
else:
    lines.append("  Hub session email:      (없음)  ← COOKIE 필요")
if len(logs) == 0:
    if email:
        lines.append("  Hub logs:               0건  ← 세션은 있으나 로그 비어 있음 (관리자 화면과 동일)")
    else:
        lines.append("  Hub logs:               0건  ← 미로그인")
    lines.append("  ※ 허브↔state 누락 교차검증 불가. 위 state 합계만 유효.")
lines += [
    "",
    "  ┌─ 최근 1시간",
    "  │ Hub logs     : {:>6}건 / {}".format(h_cnt_1h, krw(h_sum_1h)),
    "  │ State donors : {:>6}건 / {}".format(st_cnt_1h, krw(st_sum_1h)),
    "  │ Hub→State 미반영 : {}건".format(len(miss_1h)),
    "  │ (누락=허브id가 state 전체에 없음. state가 더 많은 것은 정상)",
    "  └─ 최근 24시간",
    "    Hub logs     : {:>6}건 / {}".format(h_cnt_24h, krw(h_sum_24h)),
    "    State donors : {:>6}건 / {}".format(st_cnt_24h, krw(st_sum_24h)),
    "    Hub→State 미반영 : {}건".format(len(miss_24h)),
    "",
    "  처리 백로그 QUEUE={}  UNMATCH={}".format(q_n, u_n),
]
with open(out_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
PY
}

donation_integrity_diff() {
  local out="$1"
  : > "$out" 2>/dev/null || { mkdir -p "$(dirname "$out")" 2>/dev/null; : > "$out" 2>/dev/null; }
  donation_integrity_run_py "$out" 2> "$TMP_DIR/diff.err"
  local py_rc=$?
  if [ -s "$out" ]; then
    return 0
  fi
  {
    echo "state donors: ${DBG_DONORS_N:-0}건  (${STATE_BYTES:-0} bytes)"
    echo "hub logs:     ${DBG_HUBLOG_N:-0}건  (${HUB_BYTES:-0} bytes)  login 여부는 DEBUG 줄 참고"
    echo "QUEUE=${q_len:-0}  UNMATCH=${un_len:-0}"
    echo ""
    echo "상세 교차검증은 실패했지만, 위 건수는 curl/JSON 파싱 결과로 유효합니다."
    echo "허브 로그 0건이면 관리자 '후원자 관리'의 후원 로그와 같습니다. 누락 교차검증은 불가합니다."
    if [ "${py_rc:-0}" -ne 0 ]; then
      echo "Python rc=${py_rc}"
    fi
    if [ -s "$TMP_DIR/diff.err" ]; then
      echo "  [stderr] $(head -c 300 "$TMP_DIR/diff.err" | tr '\n' ' ')"
    fi
  } > "$out" 2>/dev/null
}

render_diff_panel() {
  local cols=$1 lines=$2
  local panel_rows=$(( lines - 8 ))
  [ $panel_rows -lt 12 ] && panel_rows=12
  local pad
  pad="$(safe_pad $(( cols - 2 )))"
  printf '%s%*s%s\n' "${BOLD}${C_CYAN}┌─ 누락 상세 (허브에 있고 정산표에 없는 것만)${C_RST}" "${pad:-0}" "" "${BOLD}${C_CYAN}─┐${C_RST}"
  ui_row "${BOLD}허브 건수 < 정산표 는 정상${C_RST} ${C_DIM}· 누락 ≠ Diff(Hub-State)${C_RST}"
  pad="$(safe_pad $(( cols - 2 )))"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"

  # q_len/un_len 은 render_ui 내에서만 계산되므로, diff 뷰로 직접 진입시에도 값 존재하도록 여기서 재계산
  local q_len un_len
  q_len=$(json_field_str "$SNAP_QUEUE_JSON"   'len(d.get("items") or [])' '0')
  un_len=$(json_field_str "$SNAP_UNMATCH_JSON" 'len(d.get("items") or [])' '0')
  [[ "$q_len" =~ ^[0-9]+$ ]] || q_len=0
  [[ "$un_len" =~ ^[0-9]+$ ]] || un_len=0

  # DEBUG 상태바: JSON 크기 / 후원 건수 시각화 → 빈 데이터면 즉시 원인 파악 가능
  local st_="${C_DIM}state${C_RST}="
  if [ "${STATE_BYTES:-0}" -gt 0 ] && [ "${DBG_DONORS_N:-0}" -gt 0 ]; then
    st_="${st_}${C_GREEN}${STATE_BYTES:-0}B/${DBG_DONORS_N:-0}donors${C_RST}"
  elif [ "${STATE_BYTES:-0}" -gt 0 ]; then
    st_="${st_}${C_YELLOW}${STATE_BYTES:-0}B/0donors${C_RST}"
  else
    st_="${st_}${C_RED}0B/0donors (curl fail?)${C_RST}"
  fi
  local hb_="${C_DIM}hub${C_RST}="
  if [ "${HUB_BYTES:-0}" -gt 0 ] && [ "${DBG_HUBLOG_N:-0}" -gt 0 ]; then
    hb_="${hb_}${C_GREEN}${HUB_BYTES:-0}B/${DBG_HUBLOG_N:-0}logs${C_RST}"
  elif [ "${HUB_BYTES:-0}" -gt 0 ]; then
    local hub_email hub_ok
    hub_email=$(json_field_str "$SNAP_HUB_JSON" 'd.get("session",{}).get("email") or ""' '')
    hub_ok=$(json_field_str "$SNAP_HUB_JSON" 'd.get("ok")' '')
    local ses_tag=""
    if [ -n "$hub_email" ] && [ "$hub_email" != "null" ]; then
      ses_tag="${C_BLUE}login=${hub_email}${C_RST} "
    elif [ "$hub_ok" = "true" ]; then
      ses_tag="${C_YELLOW}ok=yes/no-email${C_RST} "
    else
      ses_tag="${C_RED}no-session${C_RST} "
    fi
    hb_="${hb_}${C_YELLOW}${HUB_BYTES:-0}B/0logs${C_RST} ${ses_tag}"
  else
    hb_="${hb_}${C_RED}0B/0logs (curl fail?)${C_RST}"
  fi
  local dbg_line="DEBUG: ${st_}  ${hb_}  base=${BASE_URL}?u=${TARGET_USER}  QUEUE=${q_len} UNMATCH=${un_len}"
  ui_row "$dbg_line"
  pad="$(safe_pad $(( cols - 2 )))"
  printf '%s%*s%s\n' "${C_CYAN}├─${C_RST}" "${pad:-0}" "" "${C_CYAN}─┤${C_RST}"
  panel_rows=$(( panel_rows - 2 ))

  local diff_out="$TMP_DIR/diff.txt"
  mkdir -p "$TMP_DIR" 2>/dev/null
  donation_integrity_diff "$diff_out"
  if [ ! -s "$diff_out" ]; then
    {
      echo "state donors: ${DBG_DONORS_N:-0}건  (${STATE_BYTES:-0} bytes)"
      echo "hub logs:     ${DBG_HUBLOG_N:-0}건  (${HUB_BYTES:-0} bytes)"
      echo ""
      if [ "${STATE_BYTES:-0}" -gt 0 ]; then
        echo "  state는 불러왔습니다. 상세 교차검증만 실패했습니다."
      else
        echo "  state / hub logs 를 아직 불러오지 못했습니다."
      fi
    } > "$diff_out" 2>/dev/null
  fi
  local shown=0 max_rows=$(( panel_rows - 2 ))
  while IFS= read -r line || [ -n "$line" ]; do
    shown=$((shown+1))
    [ $shown -gt $max_rows ] && break
    ui_row "$line"
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
