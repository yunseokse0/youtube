#!/usr/bin/env bash
# EC2 일일 디스크 정리 cron 설치 (앱·시그·MySQL 데이터 보존)
#
# 사용 (EC2에서 1회):
#   cd ~/youtube && git pull && bash deploy/ec2-setup-daily-disk-clean.sh
#
# 기본: 매일 04:10 KST에 MODE=daily 정리
#   CRON_HOUR=4 CRON_MIN=10 bash deploy/ec2-setup-daily-disk-clean.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLEAN_SH="$ROOT/deploy/ec2-free-disk.sh"
WRAPPER="/usr/local/bin/youtube-disk-clean.sh"
CRON_FILE="/etc/cron.d/youtube-disk-clean"
LOG_FILE="/var/log/youtube-disk-clean.log"
CRON_HOUR="${CRON_HOUR:-4}"
CRON_MIN="${CRON_MIN:-10}"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

if [[ ! -f "$CLEAN_SH" ]]; then
  echo "정리 스크립트 없음: $CLEAN_SH"
  exit 1
fi

run chmod +x "$CLEAN_SH"

# root cron에서 ubuntu 홈·pm2 경로를 쓰도록 래퍼
run tee "$WRAPPER" >/dev/null <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HOME=/home/ubuntu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$ROOT"
# pm2는 ubuntu 유저 프로세스 — 로그 flush는 ubuntu로 실행
if command -v runuser >/dev/null 2>&1; then
  runuser -u ubuntu -- env MODE=daily HOME=/home/ubuntu bash "$CLEAN_SH"
else
  sudo -u ubuntu env MODE=daily HOME=/home/ubuntu bash "$CLEAN_SH"
fi
EOF
run chmod 755 "$WRAPPER"

CRON_LINE="${CRON_MIN} ${CRON_HOUR} * * * root ${WRAPPER} >> ${LOG_FILE} 2>&1"
echo "$CRON_LINE" | run tee "$CRON_FILE" >/dev/null
run chmod 644 "$CRON_FILE"
run touch "$LOG_FILE"
run chmod 644 "$LOG_FILE"

echo "=== 일일 디스크 정리 cron 설치 완료 ==="
echo "스케줄: 매일 ${CRON_HOUR}:$(printf '%02d' "$CRON_MIN") (서버 로컬 TZ)"
echo "스크립트: $WRAPPER"
echo "로그: $LOG_FILE"
echo
echo "지금 한 번 실행:"
echo "  sudo $WRAPPER"
echo "확인:"
echo "  cat $CRON_FILE"
echo "  tail -n 50 $LOG_FILE"
echo "  df -h /"
