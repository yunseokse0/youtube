#!/usr/bin/env bash
# EC2 디스크 긴급 확보 (20GB 루트용) — 앱·시그 업로드·MySQL 데이터는 기본적으로 보존
# 사용:
#   bash deploy/ec2-free-disk.sh
#   SHRINK_SWAP=1 bash deploy/ec2-free-disk.sh   # 스왑 2G→1G (빌드 여유 필요할 때)
#   PURGE_NPM_CACHE=1 bash deploy/ec2-free-disk.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

echo "========== BEFORE =========="
df -h /
echo

echo "== 큰 디렉터리 후보 =="
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
  2>/dev/null || true
echo

echo "== 안전한 정리 (빌드 잔여·캐시·로그) =="
rm -rf "$ROOT/.next-staging" "$ROOT/.next.old" "$ROOT/.next/cache" 2>/dev/null || true
# Next 타입 캐시만 (실행 중 .next 본체는 유지)
rm -rf "$ROOT/.next/types" 2>/dev/null || true

if [[ "${PURGE_NPM_CACHE:-1}" == "1" ]]; then
  npm cache clean --force 2>/dev/null || true
  rm -rf "$HOME/.npm/_cacache" 2>/dev/null || true
fi

run apt-get clean 2>/dev/null || true
rm -rf /var/cache/apt/archives/*.deb 2>/dev/null || true

pm2 flush 2>/dev/null || true
rm -f "$HOME/.pm2/logs"/*.log 2>/dev/null || true
truncate -s 0 "$HOME/.pm2/pm2.log" 2>/dev/null || true

run journalctl --vacuum-size=80M 2>/dev/null || true
# 커널 로그 등 오래된 로테이션
run find /var/log -type f \( -name '*.gz' -o -name '*.1' -o -name '*.old' \) -delete 2>/dev/null || true

# MySQL 바이너리 로그(있으면) — 데이터 테이블은 건드리지 않음
if command -v mysql >/dev/null 2>&1; then
  run mysql --protocol=socket -e "PURGE BINARY LOGS BEFORE NOW();" 2>/dev/null || true
fi

# git 느슨한 객체 정리(공간 부족으로 pull 실패했을 때)
if [[ -d "$ROOT/.git" ]]; then
  git -C "$ROOT" gc --prune=now --quiet 2>/dev/null || true
fi

if [[ "${SHRINK_SWAP:-0}" == "1" ]]; then
  echo "== 스왑 축소 2G → 1G (디스크 약 1G 확보) =="
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

echo
echo "========== AFTER =========="
df -h /
echo
echo "남은 공간이 2GB 미만이면:"
echo "  1) SHRINK_SWAP=1 bash deploy/ec2-free-disk.sh"
echo "  2) PC에서 npm run build 후 .next 만 업로드 (deploy/EC2-저메모리-빌드.md 방법 B)"
echo "  3) 안 쓰는 시그: du -sh /var/lib/DIN/uploads/sigs/* | sort -h | tail"
echo
echo "배포는 디스크 여유 있을 때:"
echo "  bash deploy/deploy-on-ec2.sh"
echo "  (스테이징+기존 .next 동시 보유를 피하려면 여유 3GB+ 권장)"
