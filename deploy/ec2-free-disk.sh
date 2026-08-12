#!/usr/bin/env bash
# EC2 디스크 정리
#
# MODE=daily (cron 기본) — 큰 로그만 정리. 저장된 데이터는 절대 삭제하지 않음.
#   · 보존: .next, 시그 업로드(/var/lib/DIN), MySQL 테이블, DB 백업, node_modules, git, swap
#   · 삭제/축소: PM2 로그, journal, /var/log 로테이션 파일, 비대한 정리 로그
#
# MODE=manual (기본) — 위 로그 정리 + 빌드 잔여·캐시 등 (배포 전 긴급용)
#   SHRINK_SWAP=1 / PURGE_NPM_CACHE=0 / DO_GIT_GC=0 옵션
#
# 일일 cron: bash deploy/ec2-setup-daily-disk-clean.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${MODE:-manual}"
LOG_TAG="youtube-disk-clean"

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

# ----- 로그만 (데이터·백업·앱 산출물 보존) -----
clean_logs_only() {
  log "== 로그 정리만 (데이터 보존) =="

  # PM2 앱 로그 (프로세스/설정은 유지, 로그 파일만)
  if command -v pm2 >/dev/null 2>&1; then
    pm2 flush 2>/dev/null || true
  fi
  if [[ -d "$HOME/.pm2/logs" ]]; then
    # 내용만 비움 — 파일 inode/권한 유지
    find "$HOME/.pm2/logs" -type f \( -name '*.log' -o -name '*.log.*' \) -exec truncate -s 0 {} \; 2>/dev/null || true
  fi
  if [[ -f "$HOME/.pm2/pm2.log" ]]; then
    truncate -s 0 "$HOME/.pm2/pm2.log" 2>/dev/null || true
  fi

  # systemd journal 상한 (과거 저널만 축소)
  run journalctl --vacuum-size=80M 2>/dev/null || true

  # /var/log 로테이션·압축분만 삭제 (현재 활성 syslog 등 본문은 유지)
  run find /var/log -type f \( \
    -name '*.gz' -o -name '*.xz' -o -name '*.bz2' \
    -o -name '*.1' -o -name '*.2' -o -name '*.3' -o -name '*.4' -o -name '*.5' \
    -o -name '*.old' -o -name '*.bak' \
  \) -delete 2>/dev/null || true

  # 우리 cron 로그가 과도하게 커지면 truncate (삭제 아님)
  for f in /var/log/youtube-disk-clean.log /var/log/youtube-mysql-backup.log; do
    if [[ -f "$f" ]]; then
      run find "$f" -size +20M -exec truncate -s 0 {} \; 2>/dev/null || true
    fi
  done

  # MySQL 바이너리 로그(복제/복구용 로그) — 테이블 데이터·덤프 백업은 건드리지 않음
  # 일일에도 허용: 데이터 파일이 아니라 binlog
  if [[ "${PURGE_MYSQL_BINLOG:-1}" == "1" ]] && command -v mysql >/dev/null 2>&1; then
    run mysql --protocol=socket -e "PURGE BINARY LOGS BEFORE NOW();" 2>/dev/null || true
  fi
}

# ----- 수동 긴급: 빌드 잔여·캐시 (데이터 아님) -----
clean_build_caches() {
  log "== 빌드 잔여·캐시 정리 (데이터 아님) =="
  rm -rf "$ROOT/.next-staging" "$ROOT/.next.old" "$ROOT/.next/cache" 2>/dev/null || true
  rm -rf "$ROOT/.next/types" 2>/dev/null || true

  if [[ "${PURGE_NPM_CACHE:-1}" == "1" ]]; then
    npm cache clean --force 2>/dev/null || true
    rm -rf "$HOME/.npm/_cacache" 2>/dev/null || true
  fi

  run apt-get clean 2>/dev/null || true
  rm -rf /var/cache/apt/archives/*.deb 2>/dev/null || true

  if [[ "${DO_GIT_GC:-0}" == "1" ]] && [[ -d "$ROOT/.git" ]]; then
    log "== git gc =="
    git -C "$ROOT" gc --prune=now --quiet 2>/dev/null || true
  fi
}

log "========== BEFORE =========="
df -h / || true
BEFORE_MB="$(avail_mb || echo 0)"
BEFORE_PCT="$(pct_used || echo '?')"
log "free=${BEFORE_MB}MB used=${BEFORE_PCT}%"

if [[ "$MODE" == "manual" ]]; then
  log "== 큰 디렉터리 후보 (참고) =="
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

# 공통: 로그만
clean_logs_only

# 수동만: 캐시/빌드 잔여 (시그·DB·백업·.next 본체 제외)
if [[ "$MODE" != "daily" ]]; then
  clean_build_caches
fi

if [[ "${SHRINK_SWAP:-0}" == "1" ]] && [[ "$MODE" != "daily" ]]; then
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

if [[ "$MODE" == "daily" ]]; then
  log "daily: 로그·binlog만 처리. 업로드/DB/백업/.next 미삭제."
fi

if [[ "$MODE" == "manual" ]]; then
  echo
  echo "일일 cron(로그 전용): bash deploy/ec2-setup-daily-disk-clean.sh"
  echo "긴급 스왑 축소: SHRINK_SWAP=1 bash deploy/ec2-free-disk.sh"
fi

if [[ "${AFTER_PCT}" =~ ^[0-9]+$ ]] && [[ "$AFTER_PCT" -ge 85 ]]; then
  log "WARN ${LOG_TAG}: disk ${AFTER_PCT}% — 시그/볼륨 확장을 검토하세요"
fi
