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

TMP="$(mktemp -d 2>/dev/null || echo "/tmp/toona-gap-$$")"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

krw() {
  local n="${1:-0}"
  printf '%s원' "$(printf '%d' "$n" 2>/dev/null | sed ':a;s/\B[0-9]\{3\}\>/,&/;ta')"
}

run_once() {
  local url="${BASE_URL}/api/toona/donation-gap?hours=${HOURS}&maxPages=${MAX_PAGES}&u=${TARGET_USER}"
  local dest="$TMP/gap.json"
  local http
  http="$(curl -sS --max-time 55 --connect-timeout 5 -o "$dest" -w '%{http_code}' -b "$COOKIE" "$url" 2>/dev/null || echo 000)"

  local lines=""
  lines+="대상 ${TARGET_USER}  ${BASE_URL}  hours=${HOURS}  $(date '+%Y-%m-%d %H:%M:%S %Z')"$'\n'
  lines+="HTTP ${http}"$'\n'

  if [ ! -s "$dest" ] || [ "$http" = "000" ]; then
    lines+="판정: GAP_FAIL"$'\n'
    lines+="API 응답 없음 — pm2/nginx/PORT 를 확인하세요."
    printf '%s\n' "$lines"
    [ -n "$LOG" ] && printf '%s\n' "$lines" >> "$LOG"
    return 2
  fi

  local pyout code
  pyout="$(python3 - "$dest" <<'PY'
import json, sys
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))

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

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
except Exception as e:
    print("판정: GAP_FAIL")
    print("JSON 파싱 실패:", e)
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
