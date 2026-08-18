#!/usr/bin/env bash
# EC2 안정성 일괄 설치 — 일일 디스크 정리 + 5분 워치독 + pm2 재부팅 자동 기동
#
# 사용 (EC2에서 1회, git pull 후):
#   cd ~/youtube && bash deploy/ec2-setup-stability.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=========================================="
echo " EC2 안정성 설정"
echo "=========================================="

bash "$ROOT/deploy/ec2-setup-daily-disk-clean.sh"
bash "$ROOT/deploy/ec2-setup-watchdog.sh"
bash "$ROOT/deploy/ec2-setup-pm2-startup.sh"

echo
echo "=== 완료 ==="
echo "· 매일 04:10 — 로그·binlog 정리"
echo "· 5분마다 — 디스크·health·MySQL 점검 (자동 recover)"
echo "· 재부팅 후 — pm2 자동 기동"
echo
echo "로그: tail -f /var/log/youtube-watchdog.log"
echo "진단: bash deploy/ec2-disk-report.sh"
