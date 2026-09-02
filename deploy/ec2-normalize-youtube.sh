#!/usr/bin/env bash
# EC2 youtube 서버 정상화 (Instance Connect 한 줄)
#
#   cd ~/youtube && git pull && bash deploy/ec2-normalize-youtube.sh
#
# 옵션:
#   SKIP_BUILD=1     — git·MySQL·nginx·pm2만 (빌드 생략, ~2분)
#   DEPLOY_FAST=1    — deploy-on-ec2 빌드 단축 (OOM 시)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=deploy/ec2-free-port.sh
source "$ROOT/deploy/ec2-free-port.sh"

PM2_APP="${PM2_APP:-youtube}"
PORT="${PORT:-3000}"
SKIP_BUILD="${SKIP_BUILD:-0}"
DEPLOY_FAST="${DEPLOY_FAST:-0}"
DEPLOY_SMOKE_USER="${DEPLOY_SMOKE_USER:-din}"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

curl_code() {
  curl -sf --max-time "${2:-8}" -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo "000"
}

echo "=========================================="
echo " youtube EC2 정상화"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

echo "== 0) 진단 =="
free -h || true
df -h / || true
pm2 status 2>/dev/null || true

echo "== 1) git pull =="
git pull --ff-only

echo "== 2) Node 중지 (MySQL 먼저) =="
pm2 stop "$PM2_APP" 2>/dev/null || true
sleep 1

echo "== 3) MySQL 튜닝·비밀번호 =="
bash "$ROOT/deploy/ec2-mysql-stabilize.sh"
bash "$ROOT/deploy/ec2-mysql-sync-password-from-env.sh"

echo "== 4) MySQL SELECT 1 =="
if [[ -f /etc/mysql/youtube-app.cnf ]]; then
  mysql --defaults-extra-file=/etc/mysql/youtube-app.cnf -e "SELECT 1 AS ok;"
else
  run mysql --protocol=socket -e "SELECT 1 AS ok;"
fi

if [[ "$SKIP_BUILD" == "1" ]]; then
  echo "== 5) 빌드 생략 — pm2·nginx만 =="
  if [[ ! -f .next/BUILD_ID ]]; then
    echo "ERROR: .next 없음 — SKIP_BUILD=0 으로 재실행"
    exit 1
  fi
  bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh"
  pm2 restart "$PM2_APP" 2>/dev/null || {
    NEXT_BUILD_DIR= NEXT_USE_STAGING_DIST= pm2 start npm --name "$PM2_APP" -- start
  }
  pm2 save 2>/dev/null || true
else
  echo "== 5) 배포 (빌드·pm2·nginx) =="
  SKIP_GIT_PULL=1 DEPLOY_FAST="$DEPLOY_FAST" bash "$ROOT/deploy/deploy-on-ec2.sh"
  bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh" || true
fi

echo "== 6) 워치독(없으면 등록) =="
if [[ -f "$ROOT/deploy/ec2-setup-stability.sh" ]]; then
  bash "$ROOT/deploy/ec2-setup-stability.sh" 2>/dev/null || true
fi

echo "== 7) 검증 =="
sleep 3
wait_for_health "$PORT" || {
  echo "WARN: health 지연"
  pm2 logs "$PM2_APP" --lines 25 --nostream 2>/dev/null || true
}

echo "health        HTTP $(curl_code "http://127.0.0.1:${PORT}/api/health" 10)"
echo "health?deep=1 HTTP $(curl_code "http://127.0.0.1:${PORT}/api/health?deep=1" 15)"
curl -sf --max-time 15 "http://127.0.0.1:${PORT}/api/health?deep=1" 2>/dev/null || true
echo ""
echo "nginx /admin  HTTP $(curl_code "http://127.0.0.1/admin" 10)"
W="$(grep -oE 'webpack-[a-f0-9]+\.js' .next/build-manifest.json 2>/dev/null | head -1 || true)"
if [[ -n "$W" ]]; then
  echo "_next/static  HTTP $(curl_code "http://127.0.0.1/_next/static/chunks/${W}" 8)"
fi
echo "donor-rankings HTTP $(curl_code "http://127.0.0.1:${PORT}/api/state?u=${DEPLOY_SMOKE_USER}&pick=donor-rankings" 25)"

echo "=========================================="
echo " 정상화 완료"
echo "  브라우저: http://$(curl -sf --max-time 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_IP')/admin"
echo "  Ctrl+Shift+R · OBS 소스 새로고침"
echo "=========================================="
