#!/usr/bin/env bash
# .env DATABASE_URL 비밀번호 → MySQL youtube_app@localhost / @127.0.0.1 동기화
# (ERROR 1045 Access denied, ETIMEDOUT 후 health 000 대응)
#
# 사용 (pm2 cwd 기준 — pm2 show youtube | grep cwd):
#   cd ~/youtube && bash deploy/ec2-mysql-sync-password-from-env.sh
#
# .env 파싱 실패 시:
#   bash deploy/ec2-mysql-sync-password-from-env.sh --from-cnf
#   MYSQL_APP_PASSWORD='새비번' bash deploy/ec2-setup-mysql.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
FROM_CNF=0
# shellcheck source=deploy/ec2-free-port.sh
source "$ROOT/deploy/ec2-free-port.sh"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

for arg in "$@"; do
  case "$arg" in
    --from-cnf) FROM_CNF=1 ;;
    -h|--help)
      echo "사용: bash deploy/ec2-mysql-sync-password-from-env.sh [--from-cnf]"
      exit 0
      ;;
  esac
done

read_database_url_from_env() {
  local line raw
  line="$(
    grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL[[:space:]]*=' "$ENV_FILE" 2>/dev/null \
      | grep -v '^[[:space:]]*#' \
      | head -1 \
      || true
  )"
  if [[ -z "$line" ]]; then
    line="$(
      grep -E '^[[:space:]]*#[[:space:]]*DATABASE_URL[[:space:]]*=' "$ENV_FILE" 2>/dev/null \
        | head -1 \
        || true
    )"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line#\#}"
    line="${line#"${line%%[![:space:]]*}"}"
  fi
  if [[ -z "$line" ]]; then
    return 1
  fi
  raw="${line#export}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw#DATABASE_URL}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw#=}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  raw="${raw//$'\r'/}"
  if [[ "$raw" == \"*\" ]]; then raw="${raw:1:${#raw}-2}"; fi
  if [[ "$raw" == \'*\' ]]; then raw="${raw:1:${#raw}-2}"; fi
  # 인라인 주석 (비밀번호 # 는 URL 인코딩 %23 권장)
  if [[ "$raw" == *" #"* ]]; then
    raw="${raw%% #*}"
    raw="${raw%"${raw##*[![:space:]]}"}"
  fi
  if [[ "$raw" == *'$'* || "$raw" == *'${'* ]]; then
    echo "WARN: DATABASE_URL에 셸 변수(\$)가 있습니다 — .env에 실제 mysql:// URL을 넣으세요." >&2
    return 1
  fi
  printf '%s' "$raw"
}

read_credentials_from_cnf() {
  local cnf="${1:-/etc/mysql/youtube-app.cnf}"
  local u p
  [[ -f "$cnf" ]] || return 1
  u="$(grep -E '^[[:space:]]*user[[:space:]]*=' "$cnf" | head -1 | cut -d= -f2- | tr -d ' \r')"
  p="$(grep -E '^[[:space:]]*password[[:space:]]*=' "$cnf" | head -1 | cut -d= -f2- | tr -d '\r')"
  [[ -n "$u" ]] || return 1
  DB_USER="$u"
  DB_PASS="$p"
  DB_NAME="${MYSQL_DATABASE:-youtube}"
  return 0
}

parse_database_url() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 없음 — sudo apt install -y python3" >&2
    return 1
  fi
  python3 - "$1" <<'PY'
import re
import sys
from urllib.parse import unquote

raw = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
if not raw:
    sys.exit(2)

# jdbc:mysql://...
if raw.lower().startswith("jdbc:"):
    raw = raw[5:]

def emit(user: str, password: str, db: str) -> None:
    user = (user or "").strip()
    db = (db or "").strip()
    if not user or not db:
        sys.exit(2)
    print(user)
    print(password or "")
    print(db)

if re.match(r"mysql2?://", raw, re.I):
    m = re.match(r"mysql2?://(.+)@([^/?#]+)(?:/([^?#]*))?", raw, re.I)
    if m:
        userpass, _hostpart, db = m.group(1), m.group(2), m.group(3) or "youtube"
        if ":" in userpass:
            user, password = userpass.split(":", 1)
        else:
            user, password = userpass, ""
        db = (db or "youtube").split("?")[0].split("/")[0] or "youtube"
        emit(unquote(user), unquote(password), unquote(db))
        sys.exit(0)

    try:
        from urllib.parse import urlparse

        u = urlparse(raw)
        if re.match(r"mysql2?$", u.scheme, re.I) and u.username:
            db = (u.path or "/youtube").lstrip("/").split("?")[0].split("/")[0] or "youtube"
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

write_database_url_to_env() {
  local url="$1"
  local tmp
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "DATABASE_URL=${url}" >>"$ENV_FILE"
    return 0
  fi
  if grep -qE '^[[:space:]]*(export[[:space:]]+)?#?[[:space:]]*DATABASE_URL[[:space:]]*=' "$ENV_FILE"; then
    tmp="$(mktemp)"
    grep -vE '^[[:space:]]*(export[[:space:]]+)?#?[[:space:]]*DATABASE_URL[[:space:]]*=' "$ENV_FILE" >"$tmp" || true
    echo "DATABASE_URL=${url}" >>"$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    echo "DATABASE_URL=${url}" >>"$ENV_FILE"
  fi
}

mask_database_url() {
  local url="$1"
  python3 - "$url" <<'PY' 2>/dev/null || echo "${url//:*@/:****@}"
import re, sys
u = sys.argv[1]
print(re.sub(r'(mysql2?://[^:]+:)[^@]+(@)', r'\1****\2', u, flags=re.I))
PY
}

warn_pm2_cwd_mismatch() {
  local pm2_cwd=""
  pm2_cwd="$(pm2 show youtube 2>/dev/null | sed -n 's/.*exec cwd[[:space:]]*│[[:space:]]*\([^│]*\).*/\1/p' | head -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true)"
  if [[ -z "$pm2_cwd" ]]; then
    pm2_cwd="$(pm2 show youtube 2>/dev/null | awk -F'│' '/exec cwd/ {gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3; exit}' || true)"
  fi
  if [[ -n "$pm2_cwd" && "$pm2_cwd" != "$ROOT" ]]; then
    echo "WARN: pm2 cwd=${pm2_cwd} — 지금 폴더는 ${ROOT}"
    echo "      pm2가 쓰는 폴더에서 실행: cd ${pm2_cwd} && bash deploy/ec2-mysql-sync-password-from-env.sh"
  fi
}

DB_USER=""
DB_PASS=""
DB_NAME="youtube"
CRED_SOURCE=""

if [[ "$FROM_CNF" == "1" ]]; then
  if read_credentials_from_cnf; then
    CRED_SOURCE="cnf"
  else
    echo "ERROR: /etc/mysql/youtube-app.cnf 없음"
    exit 1
  fi
else
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: ${ENV_FILE} 없음"
    exit 1
  fi

  warn_pm2_cwd_mismatch

  DB_URL="$(read_database_url_from_env || true)"
  if [[ -n "$DB_URL" ]] && parse_out="$(parse_database_url "$DB_URL" 2>/dev/null)"; then
    DB_USER="$(sed -n '1p' <<<"$parse_out")"
    DB_PASS="$(sed -n '2p' <<<"$parse_out")"
    DB_NAME="$(sed -n '3p' <<<"$parse_out")"
    CRED_SOURCE="env"
  elif read_credentials_from_cnf; then
    echo "WARN: .env DATABASE_URL 파싱 실패 — /etc/mysql/youtube-app.cnf 사용"
    CRED_SOURCE="cnf"
  else
    masked="$(mask_database_url "${DB_URL:-}")"
    echo "ERROR: DATABASE_URL 파싱 실패"
    echo "  pm2 cwd: $(pm2 show youtube 2>/dev/null | grep -E 'exec cwd' | head -1 || echo '(pm2 없음)')"
    echo "  .env: ${ENV_FILE}"
    echo "  형식: DATABASE_URL=mysql://youtube_app:비밀번호@127.0.0.1:3306/youtube"
    if [[ -n "${DB_URL:-}" ]]; then
      echo "  현재(마스킹): ${masked}"
    else
      echo "  grep DATABASE_URL .env → 값 없음 또는 주석만 있음"
    fi
    echo ""
    echo "복구 (비밀번호 새로 맞춤 + .env 갱신):"
    echo "  cd ${ROOT}"
    echo "  MYSQL_APP_PASSWORD='새비밀번호' bash deploy/ec2-setup-mysql.sh"
    echo "  pm2 restart youtube"
    exit 1
  fi
fi

if [[ -z "$DB_USER" || -z "$DB_NAME" ]]; then
  echo "ERROR: user/db 없음"
  exit 1
fi

echo "== MySQL 비밀번호 동기화 (${CRED_SOURCE} → MySQL) =="
echo "   user=${DB_USER} db=${DB_NAME} dir=$(basename "$ROOT")"

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

ENC_PASS="$(DB_PASS="$DB_PASS" python3 - <<'PY'
import os
from urllib.parse import quote
print(quote(os.environ.get("DB_PASS", ""), safe=""))
PY
)"
NEW_URL="mysql://${DB_USER}:${ENC_PASS}@127.0.0.1:3306/${DB_NAME}"
write_database_url_to_env "$NEW_URL"

run tee /etc/mysql/youtube-app.cnf >/dev/null <<EOF
[client]
user=${DB_USER}
password=${DB_PASS}
host=127.0.0.1
EOF
run chmod 600 /etc/mysql/youtube-app.cnf

if [[ -n "$DB_PASS" ]]; then
  mysql -u "$DB_USER" -p"${DB_PASS}" -h 127.0.0.1 "$DB_NAME" -e "SELECT 1 AS ok;"
else
  mysql -u "$DB_USER" -h 127.0.0.1 "$DB_NAME" -e "SELECT 1 AS ok;"
fi
echo ".env DATABASE_URL 갱신됨"
echo "MySQL SELECT 1 OK — pm2 restart youtube"
