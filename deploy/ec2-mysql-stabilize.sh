#!/usr/bin/env bash
# EC2 저메모리(~4GB) MySQL 안정화 — OOM·ETIMEDOUT·잦은 restart 완화
# 사용: cd ~/youtube && bash deploy/ec2-mysql-stabilize.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=deploy/ec2-free-port.sh
source "$ROOT/deploy/ec2-free-port.sh"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

if ! systemctl list-unit-files mysql.service >/dev/null 2>&1; then
  echo "ERROR: mysql.service 없음 — bash deploy/ec2-setup-mysql.sh"
  exit 1
fi

AVAIL_MB="$(df -Pk / | awk 'NR==2 {print int($4/1024)}')"
MEM_MB="$(free -m | awk '/^Mem:/ {print $2}')"
POOL_MB=384
if [[ "$MEM_MB" -lt 4096 ]]; then
  POOL_MB=256
fi
if [[ "$MEM_MB" -ge 7168 ]]; then
  POOL_MB=512
fi

echo "== MySQL 튜닝 (RAM ${MEM_MB}MB → innodb_buffer_pool ${POOL_MB}MB) =="
TUNE_CNF="/etc/mysql/mysql.conf.d/zzz-youtube-tune.cnf"
run tee "$TUNE_CNF" >/dev/null <<EOF
[mysqld]
# EC2 앱+MySQL 공존 — Node·swap 여유 확보
innodb_buffer_pool_size = ${POOL_MB}M
max_connections = 40
wait_timeout = 600
interactive_timeout = 600
table_open_cache = 256
performance_schema = OFF
max_allowed_packet = 64M
connect_timeout = 10
# binlog 디스크 폭주 방지 (deploy-on-ec2.sh 와 동일)
binlog_expire_logs_seconds = 86400
EOF

echo "== MySQL 재시작 =="
run systemctl restart mysql
if ! ensure_mysql_running; then
  echo "ERROR: MySQL 기동 실패"
  exit 1
fi

echo "== 접속 스모크 =="
ENV_FILE="${ROOT}/.env"
if [[ -f "$ENV_FILE" ]] && grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r"')"
  if [[ "$DB_URL" =~ mysql://([^:]+):([^@]+)@127\.0\.0\.1:3306/([^?]+) ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASS="${BASH_REMATCH[2]}"
    DB_NAME="${BASH_REMATCH[3]}"
    if mysql -u "$DB_USER" -p"$DB_PASS" -h 127.0.0.1 "$DB_NAME" -e "SELECT 1 AS ok;" >/dev/null 2>&1; then
      echo "mysql SELECT 1 OK (${DB_NAME})"
    else
      echo "WARN: DATABASE_URL 로 SELECT 1 실패 — bash deploy/ec2-mysql-sync-password-from-env.sh"
    fi
  fi
else
  run mysql --protocol=socket -e "SELECT 1 AS ok;" 2>/dev/null && echo "mysql socket SELECT 1 OK" || true
fi

echo "== 완료 — pm2 restart 권장 =="
