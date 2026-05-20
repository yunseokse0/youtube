#!/usr/bin/env bash
# EC2: 시그 GIF 업로드 413 방지 — Nginx client_max_body_size 35M
set -euo pipefail

CONF="${1:-/etc/nginx/sites-available/default}"
MARK="client_max_body_size 35M"

if grep -qF "$MARK" "$CONF" 2>/dev/null; then
  echo "OK: already set in $CONF"
  sudo nginx -t
  sudo systemctl reload nginx
  exit 0
fi

echo "Adding $MARK to first server { } block in $CONF"
sudo cp -a "$CONF" "${CONF}.bak.$(date +%Y%m%d%H%M%S)"
sudo sed -i "/server {/a\\    $MARK;" "$CONF"
sudo nginx -t
sudo systemctl reload nginx
echo "Done. Retry sig upload from admin."
