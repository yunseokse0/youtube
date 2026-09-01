#!/usr/bin/env bash
# nginx -t 는 통과하는데 :80 이 안 열릴 때 (OBS·외부 IP 타임아웃)
# 사용: cd ~/youtube && bash deploy/ec2-fix-nginx-port80.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=deploy/ec2-free-port.sh
source "$ROOT/deploy/ec2-free-port.sh"

echo "=========================================="
echo " nginx :80 복구"
echo "=========================================="

echo "== 설정 복사·검증 =="
bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh"

echo "== 강제 재기동 =="
restart_nginx_service "$ROOT" || exit 1

code="$(curl -sf --max-time 8 -o /dev/null -w "%{http_code}" "http://127.0.0.1/admin" 2>/dev/null || echo "000")"
echo "/admin HTTP ${code}"
code="$(curl -sf --max-time 8 -o /dev/null -w "%{http_code}" "http://127.0.0.1/api/health" 2>/dev/null || echo "000")"
echo "/api/health HTTP ${code}"

echo "=========================================="
if [[ "$code" == "200" ]]; then
  echo " nginx 복구 완료 — OBS·브라우저 새로고침"
else
  echo " 여전히 실패 — sudo journalctl -u nginx -n 50"
  exit 1
fi
