#!/usr/bin/env bash
# EC2 워치독 cron 설치 (5분마다 디스크·헬스·MySQL 점검)
#
# 사용 (EC2에서 1회, 또는 deploy-on-ec2 끝에서 자동):
#   cd ~/youtube && bash deploy/ec2-setup-watchdog.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WATCHDOG_SH="$ROOT/deploy/ec2-watchdog.sh"
WRAPPER="/usr/local/bin/youtube-watchdog.sh"
CRON_FILE="/etc/cron.d/youtube-watchdog"
LOG_FILE="/var/log/youtube-watchdog.log"
CRON_EVERY_MIN="${CRON_EVERY_MIN:-5}"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

if [[ ! -f "$WATCHDOG_SH" ]]; then
  echo "워치독 스크립트 없음: $WATCHDOG_SH"
  exit 1
fi

run chmod +x "$WATCHDOG_SH"

run tee "$WRAPPER" >/dev/null <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HOME=/home/ubuntu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$ROOT"
if command -v runuser >/dev/null 2>&1; then
  runuser -u ubuntu -- env HOME=/home/ubuntu bash "$WATCHDOG_SH"
else
  sudo -u ubuntu env HOME=/home/ubuntu bash "$WATCHDOG_SH"
fi
EOF
run chmod 755 "$WRAPPER"

# */5 * * * * root ...
CRON_LINE="*/${CRON_EVERY_MIN} * * * * root ${WRAPPER} >> ${LOG_FILE} 2>&1"
echo "$CRON_LINE" | run tee "$CRON_FILE" >/dev/null
run chmod 644 "$CRON_FILE"
run touch "$LOG_FILE"
run chmod 644 "$LOG_FILE"

# 일일 디스크 정리도 함께 보장
if [[ -f "$ROOT/deploy/ec2-setup-daily-disk-clean.sh" ]]; then
  bash "$ROOT/deploy/ec2-setup-daily-disk-clean.sh" || true
fi

echo "=== EC2 워치독 cron 설치 완료 ==="
echo "스케줄: ${CRON_EVERY_MIN}분마다"
echo "동작: 디스크 ≥85% 정리 · ≥92% 강화 정리 · health 실패 시 recover (15분 쿨다운)"
echo "로그: $LOG_FILE"
echo
echo "지금 1회: sudo $WRAPPER"
echo "확인: tail -n 30 $LOG_FILE && df -h /"
