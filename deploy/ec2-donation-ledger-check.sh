#!/usr/bin/env bash
# 후원 장부가 빠졌거나, 같은 후원이 두 줄로 남았는지 EC2에서 읽기만 한다.
# 저장, 정산 리셋, 후원 반영은 하지 않는다.
#
#   cd ~/youtube && bash deploy/ec2-donation-ledger-check.sh
#   TARGET_USER=din PORT=3000 bash deploy/ec2-donation-ledger-check.sh
#   COOKIE='sb_user=...; Path=/' TARGET_USER=din bash deploy/ec2-donation-ledger-check.sh
#
# 종료 코드: 0 정상, 1 중복 또는 누락, 2 장부를 못 읽음.
set -u

PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
TARGET_USER="${TARGET_USER:-din}"
COOKIE="${COOKIE:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/deploy/ec2-donation-ledger-check.py"
if [ ! -f "$PY" ]; then
  echo "판정: STATE_FAIL"
  echo "$PY 가 없습니다. cd ~/youtube && git pull 후 다시 실행하세요."
  exit 2
fi

TMP="$(mktemp -d 2>/dev/null || echo "/tmp/ec2-ledger-$$")"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

fetch() {
  local url="$1"
  local dest="$2"
  if [ -n "$COOKIE" ]; then
    curl -sS --max-time 20 --connect-timeout 3 -b "$COOKIE" "$url" -o "$dest" || true
  else
    curl -sS --max-time 20 --connect-timeout 3 "$url" -o "$dest" || true
  fi
}

fetch "${BASE_URL}/api/state?u=${TARGET_USER}" "$TMP/state.json"
fetch "${BASE_URL}/api/toona/hub?u=${TARGET_USER}" "$TMP/hub.json"
fetch "${BASE_URL}/api/donations/queue?u=${TARGET_USER}" "$TMP/queue.json"
fetch "${BASE_URL}/api/donations/unmatched?u=${TARGET_USER}" "$TMP/unmatched.json"

PYBIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
if [ -z "$PYBIN" ]; then
  echo "판정: STATE_FAIL"
  echo "python3 가 없습니다."
  exit 2
fi

"$PYBIN" - "$TMP/queue.json" "$TMP/unmatched.json" <<'PY' > "$TMP/counts.txt"
import json, sys
def count(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return 0
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        for key in ("items", "queue", "events", "unmatched", "donors"):
            if isinstance(data.get(key), list):
                return len(data[key])
        for key in ("count", "length"):
            if isinstance(data.get(key), int):
                return data[key]
    return 0
print(count(sys.argv[1]))
print(count(sys.argv[2]))
PY

QUEUE_N="$(sed -n '1p' "$TMP/counts.txt")"
UNMATCH_N="$(sed -n '2p' "$TMP/counts.txt")"
echo "대상 ${TARGET_USER}  ${BASE_URL}"
"$PYBIN" "$PY" "$TMP/state.json" "$TMP/hub.json" "${QUEUE_N:-0}" "${UNMATCH_N:-0}"
exit $?
