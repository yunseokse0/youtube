#!/usr/bin/env bash
# 유튜브 후원 장부를 2초마다 읽는다. 저장, 정산 리셋, 후원 반영은 하지 않는다.
#
#   cd ~/youtube && bash deploy/ec2-donation-watch.sh
#   TARGET_USER=din PORT=3000 bash deploy/ec2-donation-watch.sh
#   MODE=once bash deploy/ec2-donation-watch.sh
#
# 판정은 uid 본문이다. 같은 사람·말·금액이라도 id가 다르면 각각 더한다.
# 최근 허브 창의 줄 수로 빠짐을 보지 않는다.
# 종료 코드(MODE=once): 0 정상, 1 중복·창 안 누락·허브를 못 읽음, 2 장부를 못 읽음.
set -u

PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
TARGET_USER="${TARGET_USER:-din}"
COOKIE="${COOKIE:-sb_user=%7B%22id%22%3A%22${TARGET_USER}%22%7D}"
INTERVAL="${INTERVAL:-2}"
MODE="${MODE:-watch}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/deploy/ec2-donation-watch.py"
if [ ! -f "$PY" ]; then
  echo "판정: STATE_FAIL"
  echo "$PY 가 없습니다. cd ~/youtube && git pull 후 다시 실행하세요."
  exit 2
fi

PYBIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
if [ -z "$PYBIN" ]; then
  echo "판정: STATE_FAIL"
  echo "python3 가 없습니다."
  exit 2
fi

TMP="$(mktemp -d 2>/dev/null || echo "/tmp/ec2-watch-$$")"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
PREV="$TMP/prev.json"
NEXT="$TMP/next.json"
: > "$PREV"

fetch() {
  local url="$1"
  local dest="$2"
  if [ -n "$COOKIE" ]; then
    curl -sS --max-time 20 --connect-timeout 3 -b "$COOKIE" "$url" -o "$dest" || true
  else
    curl -sS --max-time 20 --connect-timeout 3 "$url" -o "$dest" || true
  fi
}

run_once() {
  fetch "${BASE_URL}/api/state?u=${TARGET_USER}" "$TMP/state.json"
  fetch "${BASE_URL}/api/toona/hub?u=${TARGET_USER}" "$TMP/hub.json"
  echo "대상 ${TARGET_USER}  ${BASE_URL}  $(date '+%H:%M:%S')"
  "$PYBIN" "$PY" "$TMP/state.json" "$TMP/hub.json" "$PREV" "$NEXT"
  local code=$?
  if [ -s "$NEXT" ]; then
    mv "$NEXT" "$PREV"
  fi
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
