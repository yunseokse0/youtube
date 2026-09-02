#!/usr/bin/env bash
# MySQL ETIMEDOUT 근본 패치 적용 — Unix socket + circuit breaker 빌드
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

# Upstash + MySQL 동시 설정 시 MySQL socket·Redis 우선 강제
ENV_FILE="$ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  grep -q '^MYSQL_USE_SOCKET=' "$ENV_FILE" || echo 'MYSQL_USE_SOCKET=1' >> "$ENV_FILE"
  echo "env: MYSQL_USE_SOCKET=1"
fi

echo "== 빌드·배포 =="
SKIP_GIT_PULL=1 bash "$ROOT/deploy/deploy-on-ec2.sh"

echo "== 검증 =="
sleep 12
curl -sf --max-time 8 "http://127.0.0.1:3000/api/health" && echo ""
curl -sf --max-time 15 "http://127.0.0.1:3000/api/health?deep=1" && echo ""
grep -q "pool created (socket)" /home/ubuntu/.pm2/logs/youtube-out.log 2>/dev/null && echo "log: pool socket OK" || true
pm2 logs "$PM2_APP" --lines 8 --nostream 2>/dev/null || true

echo "=========================================="
echo " 완료 — /admin 탭 1개만 · Ctrl+Shift+R"
echo "=========================================="
