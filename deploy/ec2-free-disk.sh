#!/usr/bin/env bash
# EC2 디스크 정리 — 긴급(수동) / 일일(cron) 공용
#
# 사용:
#   bash deploy/ec2-free-disk.sh              # 긴급 정리 (기본)
#   MODE=daily bash deploy/ec2-free-disk.sh   # cron용 안전 정리 (스왑 축소 없음)
#   SHRINK_SWAP=1 bash deploy/ec2-free-disk.sh
#   PURGE_NPM_CACHE=0 bash deploy/ec2-free-disk.sh
#
# 일일 cron 설치:
#   bash deploy/ec2-setup-daily-disk-clean.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${MODE:-manual}"
LOG_TAG="youtube-disk-clean"
PURGE_NPM_CACHE="${PURGE_NPM_CACHE:-1}"
# 일일 모드: git gc 는 부담이 있어 기본 OFF (주 1회면 충분)
DO_GIT_GC="${DO_GIT_GC:-0}"
if [[ "$MODE" == "manual" ]]; then
  DO_GIT_GC="${DO_GIT_GC:-1}"
fi

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$MODE] $*"
}

avail_mb() {
  df -Pk / | awk 'NR==2 {print int($4/1024)}'
}

pct_used() {
  df -Pk / | awk 'NR==2 {gsub(/%/,"",$5); print $5}'
}

log "========== BEFORE =========="
df -h / || true
BEFORE_MB="$(avail_mb || echo 0)"
BEFORE_PCT="$(pct_used || echo '?')"
log "free=${BEFORE_MB}MB used=${BEFORE_PCT}%"

if [[ "$MODE" == "manual" ]]; then
  log "== 큰 디렉터리 후보 =="
  du -sh \
    "$ROOT/node_modules" \
    "$ROOT/.next" \
    "$ROOT/.next-staging" \
    "$ROOT/.next.old" \
    /var/lib/DIN \
    /var/lib/mysql \
    /swapfile \
    /var/log \
    "$HOME/.pm2" \
    "$HOME/.npm" \
    /var/backups/mysql \
    2>/dev/null || true
fi

log "== 안전한 정리 (빌드 잔여·캐시·로그) =="
# 실행 중 .next 본체·시그 업로드·MySQL 데이터는 보존
rm -rf "$ROOT/.next-staging" "$ROOT/.next.old" "$ROOT/.next/cache" 2>/dev/null || true
rm -rf "$ROOT/.next/types" 2>/dev/null || true

if [[ "$PURGE_NPM_CACHE" == "1" ]]; then
  npm cache clean --force 2>/dev/null || true
  rm -rf "$HOME/.npm/_cacache" 2>/dev/null || true
fi

run apt-get clean 2>/dev/null || true
rm -rf /var/cache/apt/archives/*.deb 2>/dev/null || true

# PM2 로그 (앱 재시작 불필요)
if command -v pm2 >/dev/null 2>&1; then
  pm2 flush 2>/dev/null || true
fi
rm -f "$HOME/.pm2/logs"/*.log 2>/dev/null || true
truncate -s 0 "$HOME/.pm2/pm2.log" 2>/dev/null || true

# journal · 로테이션된 로그
run journalctl --vacuum-size=80M 2>/dev/null || true
run find /var/log -type f \( -name '*.gz' -o -name '*.1' -o -name '*.old' \) -delete 2>/dev/null || true

# MySQL 바이너리 로그만 (테이블 데이터 미삭제)
if command -v mysql >/dev/null 2>&1; then
  run mysql --protocol=socket -e "PURGE BINARY LOGS BEFORE NOW();" 2>/dev/null || true
fi

# MySQL 덤프 백업 14일 초과분 (백업 cron과 동일 정책)
if [[ -d /var/backups/mysql ]]; then
  run find /var/backups/mysql -name 'youtube_*.sql.gz' -mtime +14 -delete 2>/dev/null || true
fi

# 정리 스크립트 자체 로그가 비대해지면 자름
if [[ -f /var/log/youtube-disk-clean.log ]]; then
  run find /var/log -name 'youtube-disk-clean.log' -size +20M -exec truncate -s 0 {} \; 2>/dev/null || true
fi

if [[ "$DO_GIT_GC" == "1" ]] && [[ -d "$ROOT/.git" ]]; then
  log "== git gc =="
  git -C "$ROOT" gc --prune=now --quiet 2>/dev/null || true
fi

# 수동 긴급: 스왑 축소 옵션
if [[ "${SHRINK_SWAP:-0}" == "1" ]]; then
  log "== 스왑 축소 2G → 1G =="
  if [[ -f /swapfile ]]; then
    run swapoff /swapfile 2>/dev/null || true
    run rm -f /swapfile
    run fallocate -l 1G /swapfile || run dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
    run chmod 600 /swapfile
    run mkswap /swapfile
    run swapon /swapfile
    if ! grep -q '/swapfile' /etc/fstab 2>/dev/null; then
      echo '/swapfile none swap sw 0 0' | run tee -a /etc/fstab >/dev/null
    fi
    swapon --show || true
  fi
fi

AFTER_MB="$(avail_mb || echo 0)"
AFTER_PCT="$(pct_used || echo '?')"
FREED=$((AFTER_MB - BEFORE_MB))
log "========== AFTER =========="
df -h / || true
log "free=${AFTER_MB}MB used=${AFTER_PCT}% (delta ${FREED}MB)"

if [[ "$MODE" == "manual" ]]; then
  echo
  echo "남은 공간이 2GB 미만이면:"
  echo "  1) SHRINK_SWAP=1 bash deploy/ec2-free-disk.sh"
  echo "  2) PC에서 npm run build 후 .next 만 업로드"
  echo "  3) 안 쓰는 시그: du -sh /var/lib/DIN/uploads/sigs/* | sort -h | tail"
  echo
  echo "일일 자동 정리 설치: bash deploy/ec2-setup-daily-disk-clean.sh"
fi

# cron 알림용: 85% 이상이면 경고 문구
if [[ "${AFTER_PCT}" =~ ^[0-9]+$ ]] && [[ "$AFTER_PCT" -ge 85 ]]; then
  log "WARN ${LOG_TAG}: disk ${AFTER_PCT}% — 시그/스왑/볼륨 확장을 검토하세요"
fi
