#!/usr/bin/env bash
# admin 504 — Node hang + nginx 60s 타임아웃 응급 복구
#   cd ~/youtube && bash deploy/ec2-fix-admin-504.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

echo "== 1. 22MB BAK 키 제거 (bulk read 방지) =="
if [[ -f /etc/mysql/youtube-app.cnf ]]; then
  run mysql --defaults-extra-file=/etc/mysql/youtube-app.cnf youtube -e \
    "DELETE FROM app_kv WHERE k LIKE '%:BAK' OR k LIKE '%:OLD_EMERGENCY_BAK';" 2>/dev/null || true
  echo "BAK keys deleted (if any)"
fi

echo "== 2. Node 복구 =="
bash "$ROOT/deploy/ec2-recover-youtube.sh"

echo "== 3. nginx timeout 120s 적용 =="
bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh" || true

echo "== 4. 검증 =="
sleep 5
curl -sf --max-time 10 "http://127.0.0.1:3000/api/health?deep=1" | head -c 200 || echo "health FAIL"
echo ""
curl -sf --max-time 30 -w "admin localhost HTTP:%{http_code} time:%{time_total}s\n" \
  "http://127.0.0.1:3000/admin" -o /dev/null || echo "admin localhost FAIL"
curl -sf --max-time 15 -w "state fast HTTP:%{http_code} time:%{time_total}s\n" \
  "http://127.0.0.1:3000/api/state?user=din&fast=1" -o /dev/null || echo "state FAIL"

echo "브라우저: Ctrl+Shift+R 로 http://$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_IP')/admin"
