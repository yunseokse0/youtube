#!/usr/bin/env bash
# EC2 ~/youtube 에서: git pull → 스테이징 빌드(서비스 유지) → .next 교체(수 초만 중단) → pm2
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PM2_APP="${PM2_APP:-youtube}"
NODE_HEAP_MB="${NODE_HEAP_MB:-2048}"
STAGING_DIR="${NEXT_BUILD_DIR:-.next-staging}"
PORT="${PORT:-3000}"

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

echo "== 스테이징 빌드 (${STAGING_DIR}) — 기존 .next 로 서비스 유지 =="
rm -rf "$STAGING_DIR"

export NODE_HEAP_MB
export NEXT_BUILD_DIR="$STAGING_DIR"
# build:prod 가 pm2 stop 하지 않도록 (OOM 시: PM2_STOP_BEFORE_BUILD=1 추가)
unset PM2_APP

set +e
npm run build:prod
BUILD_CODE=$?
set -e

if [ "$BUILD_CODE" -ne 0 ]; then
  echo "== 빌드 실패 — 스테이징 제거, 기존 .next·pm2 유지 =="
  rm -rf "$STAGING_DIR"
  pm2 restart "$PM2_APP" 2>/dev/null || pm2 start "$PM2_APP" 2>/dev/null || true
  exit "$BUILD_CODE"
fi

if [ ! -d "$STAGING_DIR" ]; then
  echo "== 빌드 산출물 없음: ${STAGING_DIR} =="
  exit 1
fi

echo "== .next 교체 (수 초만 502 가능) =="
pm2 stop "$PM2_APP" 2>/dev/null || true
rm -rf .next.old
if [ -d .next ]; then
  mv .next .next.old
fi
mv "$STAGING_DIR" .next
pm2 start "$PM2_APP" 2>/dev/null || pm2 restart "$PM2_APP" 2>/dev/null || {
  echo "== pm2 기동 실패 — .next 롤백 시도 =="
  rm -rf .next
  if [ -d .next.old ]; then
    mv .next.old .next
  fi
  pm2 restart "$PM2_APP" 2>/dev/null || true
  exit 1
}
rm -rf .next.old

echo "== health =="
sleep 2
curl -sf "http://127.0.0.1:${PORT}/api/health" && echo " health OK" || echo " health check 실패 — pm2 logs 확인"

OBS_TEXT_CODE="$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/overlay/obs-text?u=finalent&host=obs&textId=default" || echo "000")"
echo "overlay/obs-text HTTP ${OBS_TEXT_CODE}"
if [ "$OBS_TEXT_CODE" != "200" ]; then
  echo "경고: 텍스트 오버레이 라우트 비정상 — pm2 logs ${PM2_APP} 확인"
fi

echo "== pm2 =="
pm2 status "$PM2_APP" || true
