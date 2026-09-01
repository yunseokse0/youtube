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

fix_nginx_static_permissions() {
  local root="$1"
  local static_dir="${root}/.next/static"
  [[ -d "$static_dir" ]] || return 0
  echo "== nginx(www-data) static 읽기 권한 =="
  local p="$root"
  while [[ -n "$p" && "$p" != "/" ]]; do
    run chmod o+x "$p" 2>/dev/null || true
    p="$(dirname "$p")"
  done
  run find "$static_dir" -type d -exec chmod o+rx {} + 2>/dev/null || true
  run find "$static_dir" -type f -exec chmod o+r {} + 2>/dev/null || true
}

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: $SRC 없음 — cd ~/youtube && git pull"
  exit 1
fi

if [[ -f "$DEST" ]]; then
  run cp -a "$DEST" "${DEST}.bak.$(date +%Y%m%d%H%M%S)"
fi

STATIC_DIR="${ROOT}/.next/static"
if [[ ! -d "$STATIC_DIR" ]]; then
  echo "WARN: ${STATIC_DIR} 없음 — proxy 폴백용 example 그대로 복사"
  run cp "$SRC" "$DEST"
else
  echo "== static 디스크 서빙: ${STATIC_DIR} =="
  TMP="$(mktemp)"
  sed "s|__NEXT_STATIC_DIR__|${STATIC_DIR}|g" "$SRC" > "$TMP"
  run cp "$TMP" "$DEST"
  rm -f "$TMP"
  fix_nginx_static_permissions "$ROOT"
fi
run ln -sfn "$DEST" /etc/nginx/sites-enabled/youtube
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  run rm -f /etc/nginx/sites-enabled/default
fi

run nginx -t
run systemctl enable nginx 2>/dev/null || true
run systemctl stop nginx 2>/dev/null || true
sleep 1
if command -v fuser >/dev/null 2>&1; then
  run fuser -k 80/tcp 2>/dev/null || true
  sleep 1
fi
run systemctl start nginx

if ! ss -lntp 2>/dev/null | grep -q ':80 '; then
  echo "ERROR: nginx :80 미수신"
  run journalctl -u nginx -n 20 --no-pager 2>/dev/null || true
  exit 1
fi
echo "nginx :80 LISTEN OK"

code="$(curl -sf --max-time 8 -o /dev/null -w "%{http_code}" "http://127.0.0.1/admin" || echo "000")"
echo "nginx reset OK — /admin HTTP ${code}"
if [[ -d "$STATIC_DIR" ]]; then
  W="$(grep -oE 'webpack-[a-f0-9]+\.js' "${ROOT}/.next/build-manifest.json" 2>/dev/null | head -1 || true)"
  if [[ -n "$W" ]]; then
    scode="$(curl -sf --max-time 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1/_next/static/chunks/${W}" || echo "000")"
    echo "_next/static/chunks/${W} (nginx disk) HTTP ${scode}"
    if [[ "$scode" == "403" ]]; then
      echo "WARN: 403 — fix_nginx_static_permissions 재실행 또는 sudo chmod o+x /home/ubuntu"
    fi
  fi
fi
echo "브라우저: http://$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_IP')/admin"
