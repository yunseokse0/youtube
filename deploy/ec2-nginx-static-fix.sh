#!/usr/bin/env bash
# EC2: _next/static 400/404 — nginx 에 static 전용 location 추가
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="${1:-/etc/nginx/sites-available/youtube}"
if [[ ! -f "$CONF" ]]; then
  CONF="/etc/nginx/sites-available/default"
fi
MARK='location /_next/static/'

if ! grep -q 'server {' "$CONF" 2>/dev/null; then
  echo "WARN: $CONF 에 server { 없음 — reset 스크립트 실행"
  bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh"
  exit 0
fi

if grep -qF "$MARK" "$CONF" 2>/dev/null; then
  echo "OK: _next/static location already in $CONF"
  if sudo nginx -t 2>/dev/null; then
    sudo systemctl reload nginx 2>/dev/null || sudo systemctl start nginx
    exit 0
  fi
  echo "WARN: nginx -t 실패 — reset"
  bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh"
  exit 0
fi

echo "Adding /_next/static/ block after client_max_body_size in $CONF"
BACKUP="${CONF}.bak.$(date +%Y%m%d%H%M%S)"
sudo cp -a "$CONF" "$BACKUP"
sudo sed -i '/client_max_body_size/a\
\
    location /_next/static/ {\
        proxy_pass http://127.0.0.1:3000;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
        add_header Cache-Control "public, max-age=31536000, immutable";\
    }' "$CONF"
if ! sudo nginx -t 2>/dev/null; then
  echo "ERROR: nginx -t 실패 — 백업 복원 후 reset"
  sudo cp -a "$BACKUP" "$CONF"
  bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh"
  exit 1
fi
sudo systemctl reload nginx 2>/dev/null || sudo systemctl start nginx
echo "Done. Retry admin with Ctrl+Shift+R."
