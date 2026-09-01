#!/usr/bin/env bash
# EC2 긴급 복구: zombie :3000 + static 400/404 + EADDRINUSE 한 번에 처리
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=deploy/ec2-free-port.sh
source "$ROOT/deploy/ec2-free-port.sh"

PM2_APP="${PM2_APP:-youtube}"
PORT="${PORT:-3000}"

echo "=========================================="
echo " EC2 youtube 긴급 복구"
echo "=========================================="

echo "== 0) MySQL 재시작 =="
ensure_mysql_running || exit 1

if [[ ! -f .next/BUILD_ID ]]; then
  echo "ERROR: .next/BUILD_ID 없음 — bash deploy/deploy-on-ec2.sh"
  exit 1
fi

BID=$(tr -d '\n\r' < .next/BUILD_ID)
W=$(grep -oE 'webpack-[a-f0-9]+\.js' .next/build-manifest.json | head -1)
echo "BUILD_ID=$BID webpack=$W"
ls -la ".next/static/${BID}/_buildManifest.js"
ls -la ".next/static/chunks/${W}"

echo "== 1) pm2·포트 정리 =="
pm2 stop "$PM2_APP" 2>/dev/null || true
pm2 delete "$PM2_APP" 2>/dev/null || true
pm2 unset "$PM2_APP" NEXT_BUILD_DIR 2>/dev/null || true
pm2 unset "$PM2_APP" NEXT_USE_STAGING_DIST 2>/dev/null || true
unset NEXT_BUILD_DIR NEXT_USE_STAGING_DIST || true
free_listen_port "$PORT"

echo "== 2) pm2 기동 =="
cd "$ROOT"
NEXT_BUILD_DIR= NEXT_USE_STAGING_DIST= pm2 start npm --name "$PM2_APP" -- start
pm2 save 2>/dev/null || true

if ! wait_for_health "$PORT"; then
  echo "== health 실패 — EADDRINUSE 의심, 포트 재정리 =="
  pm2 delete "$PM2_APP" 2>/dev/null || true
  free_listen_port "$PORT"
  NEXT_BUILD_DIR= NEXT_USE_STAGING_DIST= pm2 start npm --name "$PM2_APP" -- start
  pm2 save 2>/dev/null || true
  wait_for_health "$PORT" || {
    echo "ERROR: health 계속 실패 — bash deploy/ec2-emergency-recover.sh 시도"
    pm2 logs "$PM2_APP" --lines 30 --nostream 2>/dev/null || true
    exit 1
  }
fi

echo "== 3) static 검증 =="
if ! verify_static_http "$PORT" "$ROOT"; then
  echo "== static 실패 — zombie 의심, 포트 강제 해제 후 재기동 =="
  pm2 delete "$PM2_APP" 2>/dev/null || true
  free_listen_port "$PORT"
  NEXT_BUILD_DIR= NEXT_USE_STAGING_DIST= pm2 start npm --name "$PM2_APP" -- start
  pm2 save 2>/dev/null || true
  sleep 4
  verify_static_http "$PORT" "$ROOT" || {
    echo "ERROR: static 계속 실패 — bash deploy/deploy-on-ec2.sh 재배포"
    pm2 logs "$PM2_APP" --lines 30 --nostream 2>/dev/null || true
    exit 1
  }
fi

if systemctl list-unit-files nginx.service >/dev/null 2>&1; then
  if ! sudo nginx -t >/dev/null 2>&1; then
    echo "== nginx 설정 오류 — reset =="
    bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh" || true
  elif ! systemctl is-active nginx >/dev/null 2>&1; then
    echo "== nginx 중지됨 — start =="
    sudo systemctl start nginx 2>/dev/null || true
  fi
  bash "$ROOT/deploy/ec2-nginx-static-fix.sh" 2>/dev/null || bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh" 2>/dev/null || true
  code="$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1/_next/static/chunks/${W}" || echo "000")"
  echo "webpack(nginx) HTTP ${code}"
  admin_code="$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1/admin" || echo "000")"
  echo "/admin(nginx :80) HTTP ${admin_code}"
  [[ "$code" == "200" ]] || echo "WARN: nginx static ${code} — sudo nginx -t && sudo systemctl reload nginx"
  [[ "$admin_code" == "200" || "$admin_code" == "307" || "$admin_code" == "302" ]] || echo "WARN: /admin ${admin_code} — sudo systemctl status nginx"
fi

if ! verify_state_api "$PORT"; then
  echo "WARN: /api/state 스모크 실패 — .env 에 DEPLOY_SMOKE_USER=din 설정 권장"
fi

echo "== 4) 상태 =="
pm2 status "$PM2_APP" || true
show_port_holders "$PORT"
pm2 env "$PM2_APP" 2>/dev/null | grep -E 'NEXT_BUILD_DIR|NEXT_USE_STAGING_DIST' || echo "(pm2 env clean)"
echo "=========================================="
echo " 복구 완료 — 브라우저 Ctrl+Shift+R"
echo " 여전히 무응답이면: bash deploy/ec2-emergency-recover.sh"
echo "=========================================="
