#!/usr/bin/env bash
# EC2 즉시 복구: _next/static 400 (next start 가 .next-staging 을 찾는 경우)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=deploy/ec2-free-port.sh
source "$ROOT/deploy/ec2-free-port.sh"
PM2_APP="${PM2_APP:-youtube}"
PORT="${PORT:-3000}"

echo "== 1) 빌드 산출물 =="
if [[ ! -f .next/BUILD_ID ]]; then
  echo "ERROR: .next/BUILD_ID 없음 — bash deploy/deploy-on-ec2.sh 로 재빌드"
  exit 1
fi
BID=$(tr -d '\n\r' < .next/BUILD_ID)
W=$(grep -oE 'webpack-[a-f0-9]+\.js' .next/build-manifest.json | head -1)
echo "BUILD_ID=$BID webpack=$W"
ls -la ".next/static/${BID}/_buildManifest.js"
ls -la ".next/static/chunks/${W}"

echo "== 2) pm2 env 정리 =="
pm2 stop "$PM2_APP" 2>/dev/null || true
pm2 delete "$PM2_APP" 2>/dev/null || true
pm2 unset "$PM2_APP" NEXT_BUILD_DIR 2>/dev/null || true
pm2 unset "$PM2_APP" NEXT_USE_STAGING_DIST 2>/dev/null || true
unset NEXT_BUILD_DIR NEXT_USE_STAGING_DIST || true

echo "== 3) pm2 재기동 (start.cjs 가 빌드 env 제거) =="
free_listen_port "$PORT"
NEXT_BUILD_DIR= NEXT_USE_STAGING_DIST= pm2 start npm --name "$PM2_APP" -- start
pm2 save 2>/dev/null || true
sleep 3

if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "== health 실패 — 포트 재정리 후 pm2 재시도 =="
  pm2 delete "$PM2_APP" 2>/dev/null || true
  free_listen_port "$PORT"
  NEXT_BUILD_DIR= NEXT_USE_STAGING_DIST= pm2 start npm --name "$PM2_APP" -- start
  pm2 save 2>/dev/null || true
  sleep 3
fi

echo "== 4) HTTP 검증 =="
curl -s -o /dev/null -w "manifest: %{http_code}\n" "http://127.0.0.1:${PORT}/_next/static/${BID}/_buildManifest.js"
curl -s -o /dev/null -w "webpack(node): %{http_code}\n" "http://127.0.0.1:${PORT}/_next/static/chunks/${W}"
if systemctl is-active nginx >/dev/null 2>&1; then
  curl -s -o /dev/null -w "webpack(nginx): %{http_code}\n" "http://127.0.0.1/_next/static/chunks/${W}"
fi
pm2 env "$PM2_APP" 2>/dev/null | grep -E 'NEXT_BUILD_DIR|NEXT_USE_STAGING_DIST' || echo "(pm2 env clean)"
echo "완료 — 브라우저 Ctrl+Shift+R"
