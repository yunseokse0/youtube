#!/usr/bin/env bash
# MySQL 안정화 + nginx static HTTP 200 + Node 재기동 (한 번에)
# 사용: cd ~/youtube && git pull && bash deploy/ec2-stabilize-mysql-and-static.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=deploy/ec2-free-port.sh
source "$ROOT/deploy/ec2-free-port.sh"

PM2_APP="${PM2_APP:-youtube}"
PORT="${PORT:-3000}"

echo "=========================================="
echo " MySQL 안정화 + static 200"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

if [[ ! -f .next/BUILD_ID ]]; then
  echo "ERROR: .next/BUILD_ID 없음 — bash deploy/deploy-on-ec2.sh"
  exit 1
fi

bash "$ROOT/deploy/ec2-mysql-stabilize.sh"

echo "== nginx static (디스크·권한·:80) =="
bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh"

BID="$(tr -d '\n\r' < .next/BUILD_ID)"
W="$(grep -oE 'webpack-[a-f0-9]+\.js' .next/build-manifest.json | head -1 || true)"
CSS="$(find .next/static/css -name '*.css' 2>/dev/null | head -1 || true)"
CSS_REL=""
if [[ -n "$CSS" ]]; then
  CSS_REL="${CSS#*.next/}"
fi

STATIC_OK=1
if [[ -n "$W" ]]; then
  code="$(curl -sf --max-time 8 -o /dev/null -w "%{http_code}" "http://127.0.0.1/_next/static/chunks/${W}" || echo "000")"
  echo "nginx static chunks/${W} HTTP ${code}"
  [[ "$code" == "200" ]] || STATIC_OK=0
fi
if [[ -n "$CSS_REL" ]]; then
  code="$(curl -sf --max-time 8 -o /dev/null -w "%{http_code}" "http://127.0.0.1/_next/static/${CSS_REL#static/}" || echo "000")"
  echo "nginx static css HTTP ${code} (${CSS_REL})"
  [[ "$code" == "200" ]] || STATIC_OK=0
fi
manifest=".next/static/${BID}/_buildManifest.js"
if [[ -f "$manifest" ]]; then
  code="$(curl -sf --max-time 8 -o /dev/null -w "%{http_code}" "http://127.0.0.1/_next/static/${BID}/_buildManifest.js" || echo "000")"
  echo "nginx static manifest HTTP ${code}"
  [[ "$code" == "200" ]] || STATIC_OK=0
fi

if [[ "$STATIC_OK" != "1" ]]; then
  echo "ERROR: static HTTP 200 미달 — bash deploy/ec2-fix-static-400.sh"
  exit 1
fi
echo "static 200 OK"

echo "== pm2 재기동 =="
pm2 restart "$PM2_APP" 2>/dev/null || {
  NEXT_BUILD_DIR= NEXT_USE_STAGING_DIST= pm2 start npm --name "$PM2_APP" -- start
}
pm2 save 2>/dev/null || true
sleep 2

if ! wait_for_health "$PORT"; then
  echo "WARN: health 지연 — pm2 logs ${PM2_APP}"
  pm2 logs "$PM2_APP" --lines 20 --nostream 2>/dev/null || true
else
  echo "health OK"
fi

deep="$(curl -sf --max-time 12 -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/api/health?deep=1" || echo "000")"
echo "health?deep=1 HTTP ${deep}"

echo "=========================================="
echo " 완료 — 브라우저 Ctrl+Shift+R"
echo "=========================================="
