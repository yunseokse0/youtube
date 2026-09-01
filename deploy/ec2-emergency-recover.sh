#!/usr/bin/env bash
# EC2 전면 복구 — ec2-recover-youtube 실패·HTTP 무응답·MySQL/Node hang
#
# 사용:
#   cd ~/youtube && bash deploy/ec2-emergency-recover.sh
#
# 여전히 실패 시:
#   sudo reboot
#   (재부팅 후) cd ~/youtube && bash deploy/ec2-emergency-recover.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=deploy/ec2-free-port.sh
source "$ROOT/deploy/ec2-free-port.sh"

PM2_APP="${PM2_APP:-youtube}"
PORT="${PORT:-3000}"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

curl_code() {
  local url="$1"
  local timeout="${2:-8}"
  curl -sf --max-time "$timeout" -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000"
}

echo "=========================================="
echo " EC2 youtube 전면 복구 (emergency)"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

echo "== 0) 진단 =="
free -h || true
df -h / || true
echo "-- mysql --"
systemctl is-active mysql 2>/dev/null || echo "mysql: inactive"
echo "-- nginx --"
systemctl is-active nginx 2>/dev/null || echo "nginx: inactive"
echo "-- :${PORT} --"
show_port_holders "$PORT" || true
echo "-- pm2 --"
pm2 status 2>/dev/null || true
echo "-- curl (타임아웃 5s) --"
echo "/api/health :$(curl_code "http://127.0.0.1:${PORT}/api/health" 5)"
echo "nginx /admin :$(curl_code "http://127.0.0.1/admin" 5)"

echo "== 1) MySQL 재시작 =="
ensure_mysql_running || exit 1

echo "== 2) Node·pm2·포트 정리 =="
pm2 kill 2>/dev/null || true
pm2 stop all 2>/dev/null || true
pm2 delete "$PM2_APP" 2>/dev/null || true
pm2 unset "$PM2_APP" NEXT_BUILD_DIR 2>/dev/null || true
pm2 unset "$PM2_APP" NEXT_USE_STAGING_DIST 2>/dev/null || true
unset NEXT_BUILD_DIR NEXT_USE_STAGING_DIST || true

if command -v pkill >/dev/null 2>&1; then
  pkill -f "next-server" 2>/dev/null || true
  pkill -f "node.*${ROOT}" 2>/dev/null || true
  sleep 1
fi

free_listen_port "$PORT" || {
  echo "WARN: 포트 ${PORT} 해제 재시도"
  run fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 2
  free_listen_port "$PORT" || true
}

echo "== 3) nginx 재기동 =="
if systemctl list-unit-files nginx.service >/dev/null 2>&1; then
  if ! run nginx -t >/dev/null 2>&1; then
    echo "nginx 설정 오류 — reset"
    bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh" || true
  else
    run systemctl start nginx 2>/dev/null || true
    run systemctl reload nginx 2>/dev/null || true
  fi
fi

echo "== 4) .next 확인 =="
if [[ ! -f .next/BUILD_ID ]]; then
  echo "WARN: .next/BUILD_ID 없음 — git pull 후 deploy-on-ec2.sh 필요할 수 있음"
  if [[ -d .next-staging ]] && [[ -f .next-staging/BUILD_ID ]]; then
    echo "== .next-staging → .next 승격 =="
    rm -rf .next.old 2>/dev/null || true
    [[ -d .next ]] && mv .next .next.old
    mv .next-staging .next
  fi
fi

if [[ ! -f .next/BUILD_ID ]]; then
  echo "ERROR: 빌드 산출물 없음 — git pull && bash deploy/deploy-on-ec2.sh"
  exit 1
fi

echo "== 5) pm2 기동 =="
cd "$ROOT"
NEXT_BUILD_DIR= NEXT_USE_STAGING_DIST= pm2 start npm --name "$PM2_APP" -- start
pm2 save 2>/dev/null || true

echo "== 6) 헬스 검증 =="
HEALTH_OK=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  code="$(curl_code "http://127.0.0.1:${PORT}/api/health" 4)"
  echo "  try ${i}: health HTTP ${code}"
  if [[ "$code" == "200" ]]; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done

if [[ "$HEALTH_OK" != "1" ]]; then
  echo "ERROR: Node health 실패"
  pm2 logs "$PM2_APP" --lines 40 --nostream 2>/dev/null || true
  echo "다음: pm2 logs $PM2_APP --lines 100"
  echo "      sudo reboot 후 이 스크립트 재실행"
  exit 1
fi

DEEP_CODE="$(curl_code "http://127.0.0.1:${PORT}/api/health?deep=1" 12)"
echo "health?deep=1 HTTP ${DEEP_CODE}"

if [[ -f .env ]] && grep -q '^DEPLOY_SMOKE_USER=' .env 2>/dev/null; then
  SMOKE_USER="$(grep -E '^DEPLOY_SMOKE_USER=' .env | head -1 | cut -d= -f2- | tr -d '\r"')"
elif [[ -n "${DEPLOY_SMOKE_USER:-}" ]]; then
  SMOKE_USER="${DEPLOY_SMOKE_USER}"
else
  SMOKE_USER="din"
fi

STATE_CODE="$(curl_code "http://127.0.0.1:${PORT}/api/state?u=${SMOKE_USER}&pick=donor-rankings" 20)"
echo "/api/state?pick=donor-rankings&u=${SMOKE_USER} HTTP ${STATE_CODE}"

NGINX_ADMIN="$(curl_code "http://127.0.0.1/admin" 8)"
echo "nginx /admin HTTP ${NGINX_ADMIN}"

if systemctl list-unit-files nginx.service >/dev/null 2>&1; then
  run systemctl reload nginx 2>/dev/null || true
fi

echo "== 7) 상태 =="
pm2 status "$PM2_APP" || true
show_port_holders "$PORT" || true

echo "=========================================="
if [[ "$NGINX_ADMIN" == "200" || "$NGINX_ADMIN" == "302" || "$NGINX_ADMIN" == "307" ]]; then
  echo " 복구 완료 — 브라우저·OBS 새로고침"
else
  echo " Node는 기동됐으나 nginx 경유 실패 — bash deploy/ec2-nginx-reset-youtube.sh"
fi
echo "=========================================="
