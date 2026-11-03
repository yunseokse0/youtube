#!/usr/bin/env bash
# toona 원장 ↔ youtube 정산표 누락 감시 (읽기 전용, ingest/리셋 안 함)
#
#   cd ~/youtube && bash deploy/ec2-toona-gap-watch.sh
#   TARGET_USER=din PORT=3000 HOURS=6 bash deploy/ec2-toona-gap-watch.sh
#   MODE=once TARGET_USER=din bash deploy/ec2-toona-gap-watch.sh
#   MODE=once LOG=/var/log/youtube-toona-gap.log bash deploy/ec2-toona-gap-watch.sh
#
# 종료 코드(MODE=once): 0 OK, 1 MISSING, 2 조회 실패(허브 미연결·API 오류)
#
# cron 예 (5분마다, 누락 시 메일 등은 별도):
#   */5 * * * * cd ~/youtube && MODE=once TARGET_USER=din bash deploy/ec2-toona-gap-watch.sh >>/var/log/youtube-toona-gap.log 2>&1
set -u

PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
TARGET_USER="${TARGET_USER:-din}"
COOKIE="${COOKIE:-sb_user=%7B%22id%22%3A%22${TARGET_USER}%22%7D}"
HOURS="${HOURS:-6}"
MAX_PAGES="${MAX_PAGES:-5}"
INTERVAL="${INTERVAL:-30}"
MODE="${MODE:-watch}"
LOG="${LOG:-}"
# pm2 reload 직후 Next 부팅 대기 (초). 재시도 간격은 RETRY_SLEEP
READY_WAIT_SEC="${READY_WAIT_SEC:-90}"
RETRY_SLEEP="${RETRY_SLEEP:-3}"

TMP="$(mktemp -d 2>/dev/null || echo "/tmp/toona-gap-$$")"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

fetch_gap() {
  local url="$1"
  local dest="$2"
  curl -sS --max-time 55 --connect-timeout 5 -o "$dest" -w '%{http_code}' -b "$COOKIE" "$url" 2>/dev/null || echo 000
}

# 000/502/503/504 이면 READY_WAIT_SEC 동안 재시도 (배포 직후 부팅 대기)
fetch_gap_ready() {
  local url="$1"
  local dest="$2"
  local deadline=$(( $(date +%s) + READY_WAIT_SEC ))
  local http="000"
  local attempt=0
  while true; do
    attempt=$((attempt + 1))
    : > "$dest"
    http="$(fetch_gap "$url" "$dest")"
    case "$http" in
      000|502|503|504)
        if [ "$(date +%s)" -ge "$deadline" ]; then
          echo "$http"
          return 0
        fi
        echo "대기 중… HTTP ${http} (시도 ${attempt}, 남은 $(( deadline - $(date +%s) ))초)" >&2
        sleep "$RETRY_SLEEP"
        ;;
      *)
        echo "$http"
        return 0
        ;;
    esac
  done
}

run_once() {
  local url="${BASE_URL}/api/toona/donation-gap?hours=${HOURS}&maxPages=${MAX_PAGES}&u=${TARGET_USER}"
  local dest="$TMP/gap.json"
  local http
  http="$(fetch_gap_ready "$url" "$dest")"

  local lines=""
  lines+="대상 ${TARGET_USER}  ${BASE_URL}  hours=${HOURS}  $(date '+%Y-%m-%d %H:%M:%S %Z')"$'\n'
  lines+="HTTP ${http}"$'\n'

  if [ ! -s "$dest" ] || [ "$http" = "000" ]; then
    lines+="판정: GAP_FAIL"$'\n'
    lines+="API 응답 없음 — 앱이 아직 안 떴거나 PORT 가 다릅니다."$'\n'
    lines+="확인: pm2 list && curl -sI ${BASE_URL}/api/health | head -n 5"$'\n'
    lines+="앱 online 후 다시: MODE=once TARGET_USER=${TARGET_USER} bash deploy/ec2-toona-gap-watch.sh"
    printf '%s\n' "$lines"
    [ -n "$LOG" ] && printf '%s\n' "$lines" >> "$LOG"
    return 2
  fi

  if [ "$http" = "404" ]; then
    lines+="판정: GAP_FAIL"$'\n'
    lines+="HTTP 404 — /api/toona/donation-gap 가 빌드에 없습니다."$'\n'
    lines+="  bash deploy/deploy-on-ec2.sh"$'\n'
    lines+="  MODE=once TARGET_USER=${TARGET_USER} bash deploy/ec2-toona-gap-watch.sh"
    printf '%s\n' "$lines"
    [ -n "$LOG" ] && printf '%s\n' "$lines" >> "$LOG"
    return 2
  fi

  if [ "$http" = "502" ] || [ "$http" = "503" ] || [ "$http" = "504" ]; then
    lines+="판정: GAP_FAIL"$'\n'
    lines+="HTTP ${http} — 게이트웨이/앱 준비 안 됨. 잠시 후 재실행하세요."
    printf '%s\n' "$lines"
    [ -n "$LOG" ] && printf '%s\n' "$lines" >> "$LOG"
    return 2
  fi

  local pyout code
  pyout="$(python3 - "$http" "$dest" <<'PY'
import json, sys
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))
http_code = str(sys.argv[1] or "")

def kst(ms):
    try:
        n = int(ms or 0)
    except Exception:
        return "-"
    if n <= 0:
        return "-"
    return datetime.fromtimestamp(n / 1000, tz=KST).strftime("%Y-%m-%d %H:%M:%S")

def krw(n):
    try:
        return "{:,}원".format(int(n or 0))
    except Exception:
        return "0원"

path = sys.argv[2]
raw = ""
try:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()
    data = json.loads(raw or "")
except Exception as e:
    print("판정: GAP_FAIL")
    print("JSON 파싱 실패:", e)
    if http_code == "404":
        print("원인: 라우트가 빌드에 없음 — bash deploy/deploy-on-ec2.sh 후 재실행")
    elif raw.strip().startswith("<"):
        print("HTML 응답(비-JSON). 배포·nginx·포트 확인")
    sys.exit(2)

if not isinstance(data, dict):
    print("판정: GAP_FAIL")
    print("응답이 객체가 아닙니다.")
    sys.exit(2)

if data.get("ok") is not True:
    err = data.get("error") or data.get("reason") or "unknown"
    print("판정: GAP_FAIL")
    print("오류:", err)
    if data.get("mode"):
        print("intake:", data.get("mode"))
    sys.exit(2)

missing = int(data.get("missing") or 0)
verdict = "MISSING" if missing > 0 else "OK"
print("판정:", verdict)
print(
    "toona 조회 {fetched}건 · 정산표 일치 {matched} · 누락 {missing} · 리셋폐기 {disc} · 무효 {skip}".format(
        fetched=int(data.get("toonaFetched") or 0),
        matched=int(data.get("matched") or 0),
        missing=missing,
        disc=int(data.get("discardedReset") or 0),
        skip=int(data.get("skippedInvalid") or 0),
    )
)
print(
    "페이지 {pages} · 끝도달 {end} · from {frm} · checked {chk}".format(
        pages=int(data.get("pages") or 0),
        end="Y" if data.get("reachedEnd") else "N",
        frm=kst(data.get("fromMs")),
        chk=kst(data.get("checkedAt")),
    )
)
samples = data.get("samples") if isinstance(data.get("samples"), list) else []
if missing > 0:
    print("누락 샘플 (최대 {}건):".format(len(samples)))
    for row in samples[:10]:
        if not isinstance(row, dict):
            continue
        print(
            "  {at}  {name}  {amt}  {tgt}  {bid}".format(
                at=kst(row.get("at")),
                name=str(row.get("donorName") or ""),
                amt=krw(row.get("amount")),
                tgt=str(row.get("target") or ""),
                bid=str(row.get("bareId") or row.get("id") or "")[:40],
            )
        )
sys.exit(1 if missing > 0 else 0)
PY
)"
  code=$?
  lines+="$pyout"
  printf '%s\n' "$lines"
  [ -n "$LOG" ] && printf '%s\n' "$lines" >> "$LOG"
  return "$code"
}

if [ "$MODE" = "once" ]; then
  run_once
  exit $?
fi

while true; do
  if [ -t 1 ]; then
    printf '\033[H\033[2J'
  fi
  run_once || true
  sleep "$INTERVAL"
done
