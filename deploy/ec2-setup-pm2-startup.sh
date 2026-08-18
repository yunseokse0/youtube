#!/usr/bin/env bash
# EC2 재부팅 후 pm2(youtube) 자동 기동
#
# 사용 (EC2에서 1회):
#   cd ~/youtube && bash deploy/ec2-setup-pm2-startup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${APP_USER:-ubuntu}"
PM2_APP="${PM2_APP:-youtube}"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 없음 — npm install -g pm2 후 재실행"
  exit 1
fi

cd "$ROOT"

if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 save || true
else
  echo "WARN: pm2 앱 '${PM2_APP}' 없음 — deploy-on-ec2 후 다시 실행"
fi

echo "== pm2 startup (systemd) =="
# 이미 등록됐으면 재실행해도 무해
STARTUP_CMD="$(pm2 startup systemd -u "$APP_USER" --hp "/home/${APP_USER}" 2>&1 | grep -E '^sudo env' || true)"
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD" || run bash -c "$STARTUP_CMD"
fi

pm2 save || true

echo "=== pm2 startup 완료 ==="
echo "재부팅 후: systemctl status pm2-${APP_USER} (또는 pm2-${APP_USER}.service)"
echo "확인: sudo reboot 후 curl -sI http://127.0.0.1:3000/api/health"
