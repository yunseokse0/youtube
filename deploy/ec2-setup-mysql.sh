#!/usr/bin/env bash
# 동일 EC2에 MySQL 8 설치 — bind 127.0.0.1, DB/유저 생성, 일일 백업 cron
# 사용:
#   MYSQL_APP_PASSWORD='강한비번' bash deploy/ec2-setup-mysql.sh
# 비밀번호 미지정 시 자동 생성 후 화면에 1회 출력 (.env DATABASE_URL 갱신)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_NAME="${MYSQL_DATABASE:-youtube}"
DB_USER="${MYSQL_APP_USER:-youtube_app}"
BIND_ADDR="127.0.0.1"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

if [[ -z "${MYSQL_APP_PASSWORD:-}" ]]; then
  MYSQL_APP_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  GENERATED_PW=1
else
  GENERATED_PW=0
fi

echo "== mysql-server 설치 =="
run apt-get update -y
run DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-server

echo "== bind-address=${BIND_ADDR} =="
CONF_DROPIN="/etc/mysql/mysql.conf.d/zzz-youtube-bind.cnf"
run tee "$CONF_DROPIN" >/dev/null <<EOF
[mysqld]
bind-address = ${BIND_ADDR}
mysqlx-bind-address = ${BIND_ADDR}
EOF

run systemctl enable mysql
run systemctl restart mysql

echo "== DB·유저 생성 (${DB_USER}@localhost + @127.0.0.1 / ${DB_NAME}) =="
# root 는 auth_socket(Ubuntu 기본) — sudo mysql
# SQL 문자열용 작은따옴표 이스케이프
# TCP(127.0.0.1)와 소켓(localhost) 호스트를 둘 다 만들어야 DATABASE_URL이 안정적으로 접속됨
SQL_PW="${MYSQL_APP_PASSWORD//\'/\'\'}"
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

echo "== 원격 root·테스트 DB 정리(가능 시) =="
run mysql --protocol=socket <<'SQL' || true
DELETE FROM mysql.user WHERE User='';
DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';
FLUSH PRIVILEGES;
SQL

echo "== 접속 검증 =="
mysql -u "$DB_USER" -p"${MYSQL_APP_PASSWORD}" -h 127.0.0.1 "$DB_NAME" -e "SELECT 1 AS ok;"
echo "LISTEN:"
run ss -lntp | grep 3306 || true

DATABASE_URL="mysql://${DB_USER}:${MYSQL_APP_PASSWORD}@127.0.0.1:3306/${DB_NAME}"

ENV_FILE="${ROOT}/.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -qE '^#?DATABASE_URL=' "$ENV_FILE"; then
    # 기존 DATABASE_URL 줄 교체(주석 포함)
    TMP="$(mktemp)"
    grep -vE '^#?DATABASE_URL=' "$ENV_FILE" > "$TMP" || true
    echo "DATABASE_URL=${DATABASE_URL}" >> "$TMP"
    mv "$TMP" "$ENV_FILE"
  else
    {
      echo ""
      echo "# MySQL (localhost only — 앱 상태 저장은 Upstash Redis 유지)"
      echo "DATABASE_URL=${DATABASE_URL}"
    } >> "$ENV_FILE"
  fi
  echo ".env DATABASE_URL 갱신됨"
else
  echo ".env 없음 — 수동으로 DATABASE_URL 설정:"
  echo "  DATABASE_URL=${DATABASE_URL}"
fi

echo "== 백업 디렉터리·스크립트 cron =="
run mkdir -p /var/backups/mysql
run chown root:root /var/backups/mysql
run chmod 750 /var/backups/mysql

# 비밀번호는 root만 읽는 defaults 파일
run tee /etc/mysql/youtube-app.cnf >/dev/null <<EOF
[client]
user=${DB_USER}
password=${MYSQL_APP_PASSWORD}
host=127.0.0.1
EOF
run chmod 600 /etc/mysql/youtube-app.cnf

BACKUP_SH="/usr/local/bin/youtube-mysql-backup.sh"
run tee "$BACKUP_SH" >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="/var/backups/mysql/youtube_${STAMP}.sql.gz"
mysqldump --defaults-extra-file=/etc/mysql/youtube-app.cnf --single-transaction --routines --triggers youtube \
  | gzip -c > "$OUT"
# 14일 이상 삭제
find /var/backups/mysql -name 'youtube_*.sql.gz' -mtime +14 -delete
echo "backup ok: $OUT"
EOF
run chmod 700 "$BACKUP_SH"

CRON_LINE="15 3 * * * root ${BACKUP_SH} >> /var/log/youtube-mysql-backup.log 2>&1"
if [[ -d /etc/cron.d ]]; then
  echo "$CRON_LINE" | run tee /etc/cron.d/youtube-mysql-backup >/dev/null
  run chmod 644 /etc/cron.d/youtube-mysql-backup
fi

echo ""
echo "=== MySQL 설정 완료 ==="
echo "bind: 127.0.0.1 only — 보안그룹에 3306 열지 마세요"
echo "SSH 터널: ssh -i key.pem -L 3306:127.0.0.1:3306 ubuntu@<ElasticIP>"
if [[ "$GENERATED_PW" == "1" ]]; then
  echo "생성된 앱 비밀번호(안전한 곳에 저장): ${MYSQL_APP_PASSWORD}"
fi
echo "수동 백업: sudo ${BACKUP_SH}"
