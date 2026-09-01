#!/usr/bin/env bash
# .env DATABASE_URL 비밀번호 → MySQL youtube_app@localhost / @127.0.0.1 동기화
# (ERROR 1045 Access denied, ETIMEDOUT 후 health 000 대응)
#
# 사용 (pm2 cwd 기준 — pm2 show youtube | grep cwd):
#   cd ~/youtube && bash deploy/ec2-mysql-sync-password-from-env.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
# shellcheck source=deploy/ec2-free-port.sh
source "$ROOT/deploy/ec2-free-port.sh"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: ${ENV_FILE} 없음"
  exit 1
fi

DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r"')"
if [[ -z "$DB_URL" ]]; then
  echo "ERROR: DATABASE_URL 없음 — ${ENV_FILE}"
  exit 1
fi

read -r DB_USER DB_PASS DB_NAME <<EOF
$(python3 - <<'PY' "$DB_URL"
import sys
from urllib.parse import unquote, urlparse
u = urlparse(sys.argv[1])
if u.scheme != "mysql" or not u.username or u.password is None:
    sys.exit("bad url")
print(unquote(u.username))
print(unquote(u.password))
print((u.path or "/youtube").lstrip("/").split("?")[0] or "youtube")
PY
)
EOF

if [[ -z "$DB_USER" || -z "$DB_PASS" ]]; then
  echo "ERROR: DATABASE_URL 파싱 실패"
  exit 1
fi

echo "== MySQL 비밀번호 동기화 (${ENV_FILE}) =="
echo "   user=${DB_USER} db=${DB_NAME} root=$(basename "$ROOT")"

ensure_mysql_running || exit 1

SQL_PW="${DB_PASS//\'/\'\'}"
run mysql --protocol=socket <<SQL
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${SQL_PW}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${SQL_PW}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${SQL_PW}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${SQL_PW}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

if [[ -f /etc/mysql/youtube-app.cnf ]]; then
  run tee /etc/mysql/youtube-app.cnf >/dev/null <<EOF
[client]
user=${DB_USER}
password=${DB_PASS}
host=127.0.0.1
EOF
  run chmod 600 /etc/mysql/youtube-app.cnf
fi

mysql -u "$DB_USER" -p"${DB_PASS}" -h 127.0.0.1 "$DB_NAME" -e "SELECT 1 AS ok;"
echo "MySQL SELECT 1 OK — pm2 restart youtube"
