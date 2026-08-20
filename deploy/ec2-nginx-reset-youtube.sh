#!/usr/bin/env bash
# EC2: /etc/nginx/sites-available/youtube 깨졌을 때 example 로 통째로 복구
# (location directive is not allowed here — sed 중복·server 블록 손상 등)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/deploy/nginx-youtube.conf.example"
DEST="/etc/nginx/sites-available/youtube"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: $SRC 없음 — cd ~/youtube && git pull"
  exit 1
fi

if [[ -f "$DEST" ]]; then
  run cp -a "$DEST" "${DEST}.bak.$(date +%Y%m%d%H%M%S)"
fi

run cp "$SRC" "$DEST"
run ln -sfn "$DEST" /etc/nginx/sites-enabled/youtube
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  run rm -f /etc/nginx/sites-enabled/default
fi

run nginx -t
run systemctl enable nginx 2>/dev/null || true
run systemctl start nginx
run systemctl reload nginx

code="$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1/admin" || echo "000")"
echo "nginx reset OK — /admin HTTP ${code}"
echo "브라우저: http://$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_IP')/admin"
