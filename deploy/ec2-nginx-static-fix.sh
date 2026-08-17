#!/usr/bin/env bash
# EC2: _next/static 400/404 — nginx 에 static 전용 location 추가
set -euo pipefail

CONF="${1:-/etc/nginx/sites-available/youtube}"
if [[ ! -f "$CONF" ]]; then
  CONF="/etc/nginx/sites-available/default"
fi
MARK='location /_next/static/'

if grep -qF "$MARK" "$CONF" 2>/dev/null; then
  echo "OK: _next/static location already in $CONF"
  sudo nginx -t
  sudo systemctl reload nginx
  exit 0
fi

echo "Adding /_next/static/ block after client_max_body_size in $CONF"
sudo cp -a "$CONF" "${CONF}.bak.$(date +%Y%m%d%H%M%S)"
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
sudo nginx -t
sudo systemctl reload nginx
echo "Done. Retry admin with Ctrl+Shift+R."
