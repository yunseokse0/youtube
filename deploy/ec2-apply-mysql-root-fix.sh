#!/usr/bin/env bash
# MySQL-only EC2 — socket + Pool(3) 패치 배포
#
#   cd ~/youtube && git pull && bash deploy/ec2-apply-mysql-root-fix.sh
#
# MySQL systemctl restart 는 하지 않음 (pm2 stop 후 Node만 재배포).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PM2_APP="${PM2_APP:-youtube}"

echo "=========================================="
echo " MySQL ETIMEDOUT 근본 패치 적용"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

echo "== socket vs TCP (Node) =="
if [[ -S /var/run/mysqld/mysqld.sock ]]; then
  echo "socket: OK (/var/run/mysqld/mysqld.sock)"
else
  echo "WARN: socket 없음 — TCP만 사용"
fi

node -e "
const fs=require('fs');
const m=require('mysql2/promise');
const cnf=fs.readFileSync('/etc/mysql/youtube-app.cnf','utf8');
const user=cnf.match(/user=(.+)/)[1].trim();
const pass=cnf.match(/password=(.+)/)[1].trim();
(async()=>{
  try {
    const c=await m.createConnection({socketPath:'/var/run/mysqld/mysqld.sock',user,password,connectTimeout:2000});
    await c.query('SELECT 1'); console.log('SOCKET test: OK'); await c.end();
  } catch(e){ console.log('SOCKET test:', e.code||e.message); }
})();
" 2>/dev/null || echo "WARN: socket Node 테스트 스킵"

echo "== Node 중지 =="
pm2 stop "$PM2_APP" 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
sleep 3

git pull --ff-only

# MySQL-only — socket 강제 (TCP 127.0.0.1 ETIMEDOUT 방지)
ENV_FILE="$ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -qE '^MYSQL_USE_SOCKET=' "$ENV_FILE"; then
    sed -i 's/^MYSQL_USE_SOCKET=.*/MYSQL_USE_SOCKET=1/' "$ENV_FILE"
  else
    echo 'MYSQL_USE_SOCKET=1' >> "$ENV_FILE"
  fi
  echo "env: MYSQL_USE_SOCKET=1"
fi

echo "== 빌드·배포 =="
SKIP_GIT_PULL=1 bash "$ROOT/deploy/deploy-on-ec2.sh"

echo "== 검증 =="
sleep 12
pm2 restart "$PM2_APP" --update-env 2>/dev/null || true
sleep 8
HEALTH="$(curl -sf --max-time 12 "http://127.0.0.1:3000/api/health?deep=1" 2>/dev/null || echo '{}')"
echo "$HEALTH"
echo "$HEALTH" | grep -q '"redisConfigured":true' && echo "Redis: configured (선택)" || echo "storage: MySQL-only (DATABASE_URL) — 정상"
echo "$HEALTH" | grep -o '"mysqlConnMode":"[^"]*"' || echo "WARN: mysqlConnMode missing — 구버전 빌드?"
grep -q "pool open (socket" /home/ubuntu/.pm2/logs/youtube-out.log 2>/dev/null && echo "log: mysql pool socket OK" || \
  grep -q "connection open (socket)" /home/ubuntu/.pm2/logs/youtube-out.log 2>/dev/null && echo "log: mysql socket OK (legacy)" || \
  grep -q "warm ping OK" /home/ubuntu/.pm2/logs/youtube-out.log 2>/dev/null && echo "log: mysql warm ping OK" || true
ERRS="$(tail -30 /home/ubuntu/.pm2/logs/youtube-error.log 2>/dev/null | grep -c ETIMEDOUT || echo 0)"
echo "error log ETIMEDOUT (last 30 lines): $ERRS"
ERR4031_CNT="$(tail -30 /home/ubuntu/.pm2/logs/youtube-error.log 2>/dev/null | grep -c 4031 || echo 0)"
echo "error log 4031 idle disconnect (last 30 lines): $ERR4031_CNT"

echo "== nginx /admin =="
ADMIN_CODE="$(curl -sf --max-time 12 -o /dev/null -w "%{http_code}" "http://127.0.0.1/admin" 2>/dev/null || echo "000")"
echo "/admin (nginx :80) HTTP ${ADMIN_CODE}"
if [[ "$ADMIN_CODE" != "200" && "$ADMIN_CODE" != "302" && "$ADMIN_CODE" != "307" ]]; then
  echo "WARN: /admin ${ADMIN_CODE} — pm2 restart + nginx reset"
  pm2 restart "$PM2_APP" --update-env 2>/dev/null || true
  sleep 10
  curl -sf --max-time 12 "http://127.0.0.1:3000/api/health" >/dev/null && echo "health :3000 OK" || echo "WARN: health :3000 fail"
  if [[ -f "$ROOT/deploy/ec2-nginx-reset-youtube.sh" ]]; then
    bash "$ROOT/deploy/ec2-nginx-reset-youtube.sh" || true
  fi
  ADMIN_CODE="$(curl -sf --max-time 12 -o /dev/null -w "%{http_code}" "http://127.0.0.1/admin" 2>/dev/null || echo "000")"
  echo "/admin after recover HTTP ${ADMIN_CODE}"
fi
pm2 logs "$PM2_APP" --lines 8 --nostream 2>/dev/null || true

echo "=========================================="
echo " 완료 — Ctrl+Shift+R 로 admin 새로고침"
echo "=========================================="
