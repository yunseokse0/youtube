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

read_database_url_from_env() {
  local line raw
  line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$ENV_FILE" 2>/dev/null | grep -v '^[[:space:]]*#' | head -1 || true)"
  if [[ -z "$line" ]]; then
    line="$(grep -E '^[[:space:]]*#?[[:space:]]*DATABASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 || true)"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line#\#}"
    line="${line#"${line%%[![:space:]]*}"}"
  fi
  if [[ -z "$line" ]]; then
    return 1
  fi
  raw="${line#DATABASE_URL=}"
  raw="${raw#export}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw#DATABASE_URL=}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  raw="${raw//$'\r'/}"
  if [[ "$raw" == \"*\" ]]; then raw="${raw:1:${#raw}-2}"; fi
  if [[ "$raw" == \'*\' ]]; then raw="${raw:1:${#raw}-2}"; fi
  printf '%s' "$raw"
}

parse_database_url() {
  python3 - "$1" <<'PY'
import re
import sys
from urllib.parse import unquote

raw = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
if not raw:
    sys.exit(2)

def emit(user: str, password: str, db: str) -> None:
    if not user or not db:
        sys.exit(2)
    print(user)
    print(password)
    print(db)

# mysql:// 또는 mysql2://
if re.match(r"mysql2?://", raw, re.I):
    # 비밀번호에 @·: 등 미인코딩 문자 — 마지막 @ 기준 분리
    m = re.match(r"mysql2?://(.+)@([^/?#]+)(?:/([^?#]*))?", raw, re.I)
    if m:
        userpass, hostpart, db = m.group(1), m.group(2), m.group(3) or "youtube"
        if ":" in userpass:
            user, password = userpass.split(":", 1)
        else:
            user, password = userpass, ""
        db = db.split("/")[0] or "youtube"
        emit(unquote(user), unquote(password), unquote(db))
        sys.exit(0)

    try:
        from urllib.parse import urlparse

        u = urlparse(raw)
        if re.match(r"mysql2?$", u.scheme, re.I) and u.username:
            db = (u.path or "/youtube").lstrip("/").split("?")[0] or "youtube"
            emit(
                unquote(u.username),
                unquote(u.password or ""),
                unquote(db),
            )
            sys.exit(0)
    except Exception:
        pass

sys.exit(2)
PY
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: ${ENV_FILE} 없음"
  exit 1
fi

DB_URL="$(read_database_url_from_env || true)"
if [[ -z "$DB_URL" ]]; then
  echo "ERROR: DATABASE_URL 없음 — ${ENV_FILE}"
  echo "  grep DATABASE_URL .env 로 한 줄(주석 아님) 확인"
  exit 1
fi

if ! parse_out="$(parse_database_url "$DB_URL" 2>/dev/null)"; then
  masked="${DB_URL//:*@/:****@}"
  echo "ERROR: DATABASE_URL 파싱 실패"
  echo "  형식: mysql://USER:PASSWORD@127.0.0.1:3306/youtube"
  echo "  현재(마스킹): ${masked}"
  echo "  비밀번호에 @/: 등 있으면 URL 인코딩(%40 등) 또는 ec2-setup-mysql.sh 재실행"
  exit 1
fi

DB_USER="$(sed -n '1p' <<<"$parse_out")"
DB_PASS="$(sed -n '2p' <<<"$parse_out")"
DB_NAME="$(sed -n '3p' <<<"$parse_out")"

if [[ -z "$DB_USER" || -z "$DB_NAME" ]]; then
  echo "ERROR: DATABASE_URL 파싱 실패 (user/db)"
  exit 1
fi

echo "== MySQL 비밀번호 동기화 (${ENV_FILE}) =="
echo "   user=${DB_USER} db=${DB_NAME} root=$(basename "$ROOT")"

ensure_mysql_running || exit 1

SQL_PW="${DB_PASS//\'/\'\'}"
run mysql --protocol=socket <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
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

if [[ -n "$DB_PASS" ]]; then
  mysql -u "$DB_USER" -p"${DB_PASS}" -h 127.0.0.1 "$DB_NAME" -e "SELECT 1 AS ok;"
else
  mysql -u "$DB_USER" -h 127.0.0.1 "$DB_NAME" -e "SELECT 1 AS ok;"
fi
echo "MySQL SELECT 1 OK — pm2 restart youtube"
