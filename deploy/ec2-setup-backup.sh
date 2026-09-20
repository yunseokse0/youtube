#!/usr/bin/env bash
# EC2 일일 백업 cron 설치 — 매일 03:30에 state JSON + MySQL 덤프
#
# 사용 (EC2에서 1회, git pull 후):
#   cd ~/youtube && bash deploy/ec2-setup-backup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_SH="$ROOT/deploy/ec2-run-daily-backup.sh"
WRAPPER="/usr/local/bin/youtube-backup.sh"
CRON_FILE="/etc/cron.d/youtube-backup"
LOG_FILE="/var/log/youtube-backup.log"
CRON_HOUR="${CRON_HOUR:-3}"
CRON_MIN="${CRON_MIN:-30}"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

if [[ ! -f "$BACKUP_SH" ]]; then
  echo "백업 실행 스크립트 없음: $BACKUP_SH"
  exit 1
fi

run chmod +x "$BACKUP_SH"

run tee "$WRAPPER" >/dev/null <<EOF
#!/usr/bin/env bash
set -u
export HOME=/home/ubuntu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# 프로젝트 루트 .env / .env.local 있으면 자동 로드
ROOT="$ROOT"
cd "\$ROOT"
if [[ -f "\$ROOT/.env" ]]; then
  set -a; source "\$ROOT/.env" || true; set +a
fi
if [[ -f "\$ROOT/.env.local" ]]; then
  set -a; source "\$ROOT/.env.local" || true; set +a
fi
if command -v runuser >/dev/null 2>&1; then
  runuser -u ubuntu -- env HOME=/home/ubuntu bash "$BACKUP_SH"
else
  sudo -u ubuntu env HOME=/home/ubuntu bash "$BACKUP_SH"
fi
EOF
run chmod 755 "$WRAPPER"

CRON_LINE="${CRON_MIN} ${CRON_HOUR} * * * root ${WRAPPER} >> ${LOG_FILE} 2>&1"
echo "$CRON_LINE" | run tee "$CRON_FILE" >/dev/null
run chmod 644 "$CRON_FILE"
run touch "$LOG_FILE"
run chmod 644 "$LOG_FILE"

# .env / .env.local 권한 600 강제 보정 (보안)
if [[ -f "$ROOT/.env" ]]; then run chmod 600 "$ROOT/.env" 2>/dev/null || true; fi
if [[ -f "$ROOT/.env.local" ]]; then run chmod 600 "$ROOT/.env.local" 2>/dev/null || true; fi
run chown ubuntu:ubuntu "$ROOT/.env" "$ROOT/.env.local" 2>/dev/null || true

echo "=== EC2 일일 백업 cron 설치 완료 ==="
echo "스케줄: 매일 ${CRON_HOUR}시 ${CRON_MIN}분"
echo "저장: state JSON ${KEEP_STATE_DAYS:-30}일 / MySQL ${KEEP_MYSQL_DAYS:-14}일"
echo "백업 디렉터리: \$HOME/.din-studio/backup (기본)"
echo "로그: tail -f $LOG_FILE"
echo
echo "지금 1회 실행: sudo $WRAPPER"
echo "백업 직후 확인: ls -la ~/.din-studio/backup/state ~/.din-studio/backup/mysql"
