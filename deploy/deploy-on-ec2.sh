#!/usr/bin/env bash
# EC2 ~/youtube 에서: git pull → (스왑) → 저메모리 빌드 → pm2
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PM2_APP="${PM2_APP:-youtube}"
NODE_HEAP_MB="${NODE_HEAP_MB:-2048}"

echo "== git pull =="
git pull --ff-only

if ! swapon --show 2>/dev/null | grep -q .; then
  echo "== swap 없음 — 설정 시도 =="
  bash deploy/ec2-setup-swap.sh || {
    echo "스왑 설정 실패. sudo bash deploy/ec2-setup-swap.sh 후 다시 실행하세요."
    exit 1
  }
fi

echo "== 메모리 =="
free -h

echo "== .next 백업 후 빌드 (실패 시 이전 빌드로 복구) =="
rm -rf .next.prev
if [ -d .next ]; then
  mv .next .next.prev
fi

echo "== build:prod =="
export PM2_APP NODE_HEAP_MB
set +e
npm run build:prod
BUILD_CODE=$?
set -e

if [ "$BUILD_CODE" -ne 0 ]; then
  echo "== 빌드 실패 — .next 복구 및 pm2 재기동 =="
  rm -rf .next
  if [ -d .next.prev ]; then
    mv .next.prev .next
  fi
  pm2 restart "$PM2_APP" 2>/dev/null || pm2 start "$PM2_APP" 2>/dev/null || true
  exit "$BUILD_CODE"
fi
rm -rf .next.prev

echo "== health =="
sleep 2
curl -sf "http://127.0.0.1:${PORT:-3000}/api/health" && echo " OK" || echo " health check 실패 — pm2 logs 확인"

echo "== pm2 =="
pm2 status "$PM2_APP" || true
