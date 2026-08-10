#!/usr/bin/env bash
# EC2(Ubuntu)에서 youtube 런타임 + (기본) MySQL 초기화까지 한 번에
# 사용 (레포가 ~/youtube 일 때):
#   cd ~/youtube && bash deploy/ec2-bootstrap.sh
# MySQL만 건너뛰려면: SKIP_MYSQL=1 bash deploy/ec2-bootstrap.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_MYSQL="${SKIP_MYSQL:-0}"
APP_USER="${APP_USER:-ubuntu}"
UPLOAD_ROOT="${SIG_UPLOADS_DATA_DIR:-/var/lib/DIN}"

REPO_URL="${REPO_URL:-}"
PM2_APP="${PM2_APP:-youtube}"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

echo "== apt 기본 패키지 =="
run apt-get update -y
run DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
run DEBIAN_FRONTEND=noninteractive apt-get install -y \
  nginx git curl build-essential ca-certificates gnupg ufw

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo 0)" -lt 20 ]]; then
  echo "== Node.js 20 LTS =="
  curl -fsSL https://deb.nodesource.com/setup_20.x | run bash -
  run DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
node -v
npm -v

if ! command -v pm2 >/dev/null 2>&1; then
  echo "== pm2 전역 설치 =="
  run npm install -g pm2
fi

echo "== 스왑 =="
bash "$ROOT/deploy/ec2-setup-swap.sh" || run bash "$ROOT/deploy/ec2-setup-swap.sh"

echo "== 시그 업로드 영구 경로: ${UPLOAD_ROOT} =="
run mkdir -p "${UPLOAD_ROOT}/uploads/sigs"
run chown -R "${APP_USER}:${APP_USER}" "${UPLOAD_ROOT}"

echo "== ufw (OpenSSH + Nginx HTTP) =="
run ufw allow OpenSSH || true
run ufw allow 'Nginx HTTP' || true
echo "y" | run ufw enable || true
run ufw status || true

echo "== Nginx youtube 설정 =="
NGINX_SITE="/etc/nginx/sites-available/youtube"
if [[ ! -f "$NGINX_SITE" ]]; then
  run cp "$ROOT/deploy/nginx-youtube.conf.example" "$NGINX_SITE"
  run ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/youtube
  if [[ -f /etc/nginx/sites-enabled/default ]]; then
    run rm -f /etc/nginx/sites-enabled/default
  fi
fi
# example 에 이미 35M 있음 — 누락 시 보강
if ! grep -qF "client_max_body_size 35M" "$NGINX_SITE" 2>/dev/null; then
  bash "$ROOT/deploy/ec2-nginx-upload-limit.sh" "$NGINX_SITE" || run bash "$ROOT/deploy/ec2-nginx-upload-limit.sh" "$NGINX_SITE" || true
fi
run nginx -t
run systemctl enable nginx
run systemctl reload nginx

if [[ ! -f "$ROOT/.env" ]]; then
  echo "== .env 없음 — .env.example 복사 (값을 반드시 채우세요) =="
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "  DATABASE_URL(MySQL), ADMIN_ACCOUNTS_KEY, AUTH_COOKIE_SECURE 확인 필요"
fi

# .env 에 업로드 경로 힌트가 없으면 주석으로 안내만 (자동 overwrite 안 함)
if ! grep -q 'SIG_UPLOADS_DATA_DIR' "$ROOT/.env" 2>/dev/null; then
  {
    echo ""
    echo "# ec2-bootstrap 추가"
    echo "SIG_UPLOADS_DATA_DIR=${UPLOAD_ROOT}"
    echo "AUTH_COOKIE_SECURE=false"
  } >> "$ROOT/.env"
fi

echo "== npm ci =="
if [[ -f "$ROOT/package-lock.json" ]]; then
  npm ci
else
  npm install
fi

if [[ "$SKIP_MYSQL" != "1" ]]; then
  echo "== MySQL 설치·초기화 =="
  bash "$ROOT/deploy/ec2-setup-mysql.sh"
else
  echo "== SKIP_MYSQL=1 — MySQL 단계 생략 =="
fi

echo "== 빌드·pm2 (DATABASE_URL 등 .env 준비 후) =="
if grep -qE '^DATABASE_URL=mysql://.+' "$ROOT/.env" 2>/dev/null || grep -qE '^UPSTASH_REDIS_REST_URL=.+' "$ROOT/.env" 2>/dev/null; then
  bash "$ROOT/deploy/deploy-on-ec2.sh" || {
    echo "deploy-on-ec2 실패 — .env·메모리를 확인한 뒤 다시: bash deploy/deploy-on-ec2.sh"
    exit 1
  }
  pm2 save || true
  curl -sI "http://127.0.0.1:3000/api/health" | head -n 5 || true
else
  echo "DATABASE_URL 또는 UPSTASH_REDIS_REST_URL 미설정 — 빌드/pm2 생략"
  echo "MySQL 설치 후 .env 의 DATABASE_URL 확인 → bash deploy/deploy-on-ec2.sh && pm2 save"
fi

echo ""
echo "=== bootstrap 완료 ==="
echo "문서: deploy/EC2-MySQL-setup.md"
echo "컷오버: bash deploy/ec2-cutover-checklist.sh"
