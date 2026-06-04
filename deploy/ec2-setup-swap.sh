#!/usr/bin/env bash
# EC2 1GB RAM 등 — Next.js 빌드용 스왑(기본 2GB). 인스턴스 업그레이드 없이 1회 실행.
set -euo pipefail

SWAP_SIZE="${SWAP_SIZE:-2G}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"

if swapon --show 2>/dev/null | grep -q .; then
  echo "[swap] 이미 활성화됨:"
  swapon --show
  free -h
  exit 0
fi

if [[ ! -w / ]] && [[ "$(id -u)" != "0" ]]; then
  echo "[swap] sudo 필요: sudo bash deploy/ec2-setup-swap.sh"
  exit 1
fi

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

if [[ -f "$SWAP_FILE" ]]; then
  echo "[swap] 기존 $SWAP_FILE 발견 — fallocate 생략, swapon만 시도"
  echo "       (fallocate 'Text file busy' = 이미 스왑으로 쓰는 중일 수 있음)"
  if swapon --show 2>/dev/null | grep -q "$SWAP_FILE"; then
    echo "[swap] 이미 $SWAP_FILE 이 활성 스왑입니다."
    swapon --show
    free -h
    exit 0
  fi
else
  echo "[swap] $SWAP_SIZE 스왑 파일 생성: $SWAP_FILE"
  run fallocate -l "$SWAP_SIZE" "$SWAP_FILE" || run dd if=/dev/zero of="$SWAP_FILE" bs=1M count=2048 status=progress
  run chmod 600 "$SWAP_FILE"
  run mkswap "$SWAP_FILE"
fi

run swapon "$SWAP_FILE" 2>/dev/null || {
  echo "[swap] swapon 실패. 상태 확인:"
  ls -lh "$SWAP_FILE" 2>/dev/null || true
  file "$SWAP_FILE" 2>/dev/null || true
  swapon --show 2>/dev/null || true
  free -h
  exit 1
}

if ! grep -q "$SWAP_FILE" /etc/fstab 2>/dev/null; then
  echo "[swap] /etc/fstab 등록 (재부팅 후 유지)"
  echo "$SWAP_FILE none swap sw 0 0" | run tee -a /etc/fstab >/dev/null
fi

echo "[swap] 완료:"
swapon --show
free -h
