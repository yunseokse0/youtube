#!/usr/bin/env bash
# EC2 디스크 어디에 용량이 쓰였는지 진단 (삭제하지 않음)
# 사용: bash deploy/ec2-disk-report.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "========== df =========="
df -hT / /var /home 2>/dev/null || df -h /
echo

echo "========== / 상위 용량 =========="
sudo du -xhd1 / 2>/dev/null | sort -h | tail -n 20
echo

echo "========== 후보 경로 =========="
du -sh \
  "$ROOT" \
  "$ROOT/node_modules" \
  "$ROOT/.next" \
  "$ROOT/.next-staging" \
  "$ROOT/.git" \
  /var/lib/DIN \
  /var/lib/DIN/uploads \
  /var/lib/mysql \
  /var/backups/mysql \
  /var/log \
  /swapfile \
  "$HOME/.pm2" \
  "$HOME/.npm" \
  /var/cache/apt \
  2>/dev/null | sort -h
echo

echo "========== 큰 로그 파일 (상위 20) =========="
sudo find /var/log "$HOME/.pm2" -type f \( -name '*.log' -o -name '*.gz' -o -name 'journal' \) \
  -printf '%s\t%p\n' 2>/dev/null | sort -n | tail -n 20 | awk '{printf "%.1fMB\t%s\n", $1/1024/1024, $2}'
echo

echo "해석: Use% 80%+ 또는 Avail 2G 미만이면 부족."
echo "시그·MySQL·.next 본체는 일일 정리가 지우지 않습니다."
