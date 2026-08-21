#!/usr/bin/env bash
# EC2 원클릭 배포: pull → (디스크/스왑/binlog 보장) → 스테이징 빌드(서비스 유지) → .next 교체 → pm2 reload
# 사용 (레포 루트):
#   bash deploy/deploy-on-ec2.sh
#
# 환경변수(선택):
#   PM2_APP=youtube
#   NODE_HEAP_MB=1536|2048
#   SWAP_SIZE=1G              # 빌드용 스왑 (기본 1G — 20GB 디스크용)
#   KEEP_SWAP=1              # 빌드 후 스왑 유지(기본). 0 이면 빌드 후 제거
#   PM2_STOP_BEFORE_BUILD=0  # 1 이면 빌드 전 pm2 stop (OOM 시만). 기본 0 = 빌드 중에도 서비스 유지
#   DEPLOY_FAST=1            # 빌드 전 pm2 stop + cpus=2 + 검증·cron 생략 (2~5분 단축, 빌드 중 502)
#   STOP_MYSQL_FOR_BUILD=1   # 빌드 중 MySQL 일시 정지(기본 0 — 엑셀/후원 유실 방지. OOM 시에만 1)
#   SKIP_GIT_PULL=0
#   DEPLOY_SMOKE_USER=din       # 배포 후 /api/state 스모크 (미설정 시 생략)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=deploy/ec2-free-port.sh
source "$ROOT/deploy/ec2-free-port.sh"

PM2_APP="${PM2_APP:-youtube}"
NODE_HEAP_MB="${NODE_HEAP_MB:-1536}"
STAGING_DIR="${NEXT_BUILD_DIR:-.next-staging}"
PORT="${PORT:-3000}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_SIZE="${SWAP_SIZE:-1G}"
KEEP_SWAP="${KEEP_SWAP:-1}"
PM2_STOP_BEFORE_BUILD="${PM2_STOP_BEFORE_BUILD:-0}"
STOP_MYSQL_FOR_BUILD="${STOP_MYSQL_FOR_BUILD:-0}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
DEPLOY_FAST="${DEPLOY_FAST:-0}"
MYSQL_WAS_STOPPED=0
SWAP_CREATED_BY_US=0
PM2_STOPPED_FOR_BUILD=0

run() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
}

cleanup_on_fail() {
  echo "== 실패 복구: MySQL·pm2 기동 보장 =="
  if [[ "$MYSQL_WAS_STOPPED" == "1" ]]; then
    run systemctl start mysql 2>/dev/null || true
  fi
  pm2 start "$PM2_APP" 2>/dev/null || pm2 restart "$PM2_APP" 2>/dev/null || true
}
trap cleanup_on_fail ERR

echo "=========================================="
echo " youtube EC2 자동 배포"
echo "=========================================="

# ----- 디스크 -----
AVAIL_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
AVAIL_MB=$((AVAIL_KB / 1024))
echo "== disk free: ${AVAIL_MB}MB =="
if [[ "$AVAIL_MB" -lt 2000 ]]; then
  echo "== 여유 부족 — 캐시·빌드 잔여 자동 정리 =="
  rm -rf "$STAGING_DIR" .next.old .next/cache .next/types 2>/dev/null || true
  npm cache clean --force 2>/dev/null || true
  rm -rf "${HOME}/.npm/_cacache" 2>/dev/null || true
  run apt-get clean 2>/dev/null || true
  pm2 flush 2>/dev/null || true
  run journalctl --vacuum-size=80M 2>/dev/null || true
  AVAIL_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
  AVAIL_MB=$((AVAIL_KB / 1024))
  echo "== disk free after clean: ${AVAIL_MB}MB =="
fi
if [[ "$AVAIL_MB" -lt 900 ]]; then
  echo "여유 ${AVAIL_MB}MB — ENOSPC 위험. bash deploy/ec2-free-disk.sh 후 재실행하세요."
  exit 1
fi
PCT_USED="$(df -Pk / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if [[ "${PCT_USED:-0}" -ge 96 ]]; then
  echo "디스크 사용 ${PCT_USED}% — static 빌드 누락(404) 위험. ec2-free-disk.sh 후 재실행하세요."
  exit 1
fi

echo "== 이전 스테이징·백업 제거 (실행 중 .next 는 유지) =="
rm -rf .next.old
if [[ "$DEPLOY_FAST" == "1" ]]; then
  echo "== DEPLOY_FAST=1 — 빌드 전 pm2 stop · webpack cpus=2 · heap=2048 =="
  PM2_STOP_BEFORE_BUILD=1
  NODE_HEAP_MB=2048
  export BUILD_CPUS=2
fi

# ----- MySQL binlog 만료 (디스크 재폭발 방지) -----
BINLOG_CNF="/etc/mysql/mysql.conf.d/zzz-binlog-expire.cnf"
if [[ ! -f "$BINLOG_CNF" ]]; then
  echo "== MySQL binlog 1일 만료 설정 =="
  run tee "$BINLOG_CNF" >/dev/null <<'EOF'
[mysqld]
binlog_expire_logs_seconds=86400
EOF
  if systemctl is-active --quiet mysql 2>/dev/null; then
    run mysql --protocol=socket -e "SET GLOBAL binlog_expire_logs_seconds=86400; PURGE BINARY LOGS BEFORE NOW();" 2>/dev/null || true
  fi
fi

# ----- git -----
if [[ "$SKIP_GIT_PULL" != "1" ]]; then
  echo "== git pull =="
  if ! git diff --quiet -- tsconfig.json 2>/dev/null; then
    echo "tsconfig.json 로컬 변경 감지 — checkout 후 pull"
    git checkout -- tsconfig.json
  fi
  git pull --ff-only
fi

# ----- 스왑 (빌드용 1G) -----
ensure_swap() {
  if swapon --show 2>/dev/null | grep -q .; then
    echo "== swap 이미 활성 =="
    swapon --show || true
    return 0
  fi
  echo "== swap ${SWAP_SIZE} 준비 (${SWAP_FILE}) =="
  if [[ -f "$SWAP_FILE" ]]; then
    run chmod 600 "$SWAP_FILE" || true
    run mkswap "$SWAP_FILE" 2>/dev/null || true
    run swapon "$SWAP_FILE" 2>/dev/null || {
      run rm -f "$SWAP_FILE"
    }
  fi
  if ! swapon --show 2>/dev/null | grep -q .; then
    run fallocate -l "$SWAP_SIZE" "$SWAP_FILE" || run dd if=/dev/zero of="$SWAP_FILE" bs=1M count=1024 status=none
    run chmod 600 "$SWAP_FILE"
    run mkswap "$SWAP_FILE"
    run swapon "$SWAP_FILE"
    SWAP_CREATED_BY_US=1
  fi
  if ! grep -q "$SWAP_FILE" /etc/fstab 2>/dev/null; then
    echo "$SWAP_FILE none swap sw 0 0" | run tee -a /etc/fstab >/dev/null
  fi
  swapon --show || true
}
ensure_swap

echo "== 메모리 =="
free -h

# ----- 빌드 중 MySQL 일시 정지 (OOM 방지) -----
# MySQL 을 끄면 앱이 빈/메모리 상태를 서빙·저장할 수 있음 → 반드시 앱을 먼저 중지
if [[ "$STOP_MYSQL_FOR_BUILD" == "1" ]] && systemctl is-active --quiet mysql 2>/dev/null; then
  echo "== 빌드 중 앱·MySQL 일시 정지 (데이터 유실 방지: 앱 먼저 중지) =="
  pm2 stop "$PM2_APP" 2>/dev/null || true
  PM2_STOPPED_FOR_BUILD=1
  run systemctl stop mysql
  MYSQL_WAS_STOPPED=1
elif [[ "$PM2_STOP_BEFORE_BUILD" == "1" ]]; then
  echo "== PM2_STOP_BEFORE_BUILD=1 — 빌드 전 pm2 stop (OOM/RAM 확보) =="
  pm2 stop "$PM2_APP" 2>/dev/null || true
  PM2_STOPPED_FOR_BUILD=1
else
  echo "== 빌드 중 서비스 유지 (스테이징 ${STAGING_DIR} → 완료 후 .next 교체·pm2 reload) =="
fi

verify_build_output() {
  local dir="$1"
  local bid manifest webpack
  bid="$(tr -d '\n\r' < "${dir}/BUILD_ID")"
  manifest="${dir}/static/${bid}/_buildManifest.js"
  if [[ ! -f "$manifest" ]]; then
    echo "== 불완전 빌드: ${manifest} 없음 =="
    ls -la "${dir}/static/" 2>/dev/null || true
    return 1
  fi
  webpack="$(grep -oE 'webpack-[a-f0-9]+\.js' "${dir}/build-manifest.json" | head -1)"
  if [[ -z "$webpack" ]] || [[ ! -f "${dir}/static/chunks/${webpack}" ]]; then
    echo "== webpack chunk 없음: ${webpack} =="
    return 1
  fi
  echo "== 빌드 검증 OK BUILD_ID=${bid} webpack=${webpack} =="
  return 0
}

verify_static_serving() {
  local bid webpack code html_w
  bid="$(tr -d '\n\r' < .next/BUILD_ID)"
  webpack="$(grep -oE 'webpack-[a-f0-9]+\.js' .next/build-manifest.json | head -1)"
  if [[ -z "$webpack" ]]; then
    echo "== webpack chunk 이름 추출 실패 =="
    return 1
  fi
  code="$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/_next/static/${bid}/_buildManifest.js" || echo "000")"
  echo "_next/static/${bid}/_buildManifest.js HTTP ${code}"
  if [[ "$code" != "200" ]]; then
    return 1
  fi
  code="$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/_next/static/chunks/${webpack}" || echo "000")"
  echo "_next/static/chunks/${webpack} HTTP ${code} (node :${PORT})"
  if [[ "$code" != "200" ]]; then
    pm2 env "$PM2_APP" 2>/dev/null | grep -E 'NEXT_BUILD_DIR|NEXT_USE_STAGING_DIST' || true
    return 1
  fi
  if systemctl is-active nginx >/dev/null 2>&1; then
    code="$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1/_next/static/chunks/${webpack}" || echo "000")"
    echo "_next/static/chunks/${webpack} HTTP ${code} (nginx :80)"
    if [[ "$code" != "200" ]]; then
      return 1
    fi
  fi
  html_w="$(curl -sf "http://127.0.0.1:${PORT}/login" 2>/dev/null | grep -oE 'webpack-[a-f0-9]+\.js' | head -1 || true)"
  if [[ -n "$html_w" && "$html_w" != "$webpack" ]]; then
    echo "== HTML webpack(${html_w}) != build(${webpack}) =="
    return 1
  fi
  return 0
}

echo "== 스테이징 빌드 (${STAGING_DIR}) heap=${NODE_HEAP_MB}MB cpus=${BUILD_CPUS:-1} =="
export BUILD_CPUS="${BUILD_CPUS:-1}"
export BUILD_KEEP_CACHE="${BUILD_KEEP_CACHE:-1}"
# webpack 캐시는 build-prod.mjs 가 보존 — 여기서 staging 전체 삭제하지 않음
set +e
# 빌드 자식에만 NEXT_BUILD_DIR 전달 — PM2_APP 미전달·PM2_STOP_BEFORE_BUILD=0 으로 빌드 중 서비스 유지
env -u PM2_APP NEXT_BUILD_DIR="$STAGING_DIR" NODE_HEAP_MB="$NODE_HEAP_MB" BUILD_CPUS="$BUILD_CPUS" BUILD_KEEP_CACHE="$BUILD_KEEP_CACHE" PM2_STOP_BEFORE_BUILD="${PM2_STOP_BEFORE_BUILD}" npm run build:prod
BUILD_CODE=$?
set -e
unset NEXT_BUILD_DIR NEXT_USE_STAGING_DIST || true

if [[ "$BUILD_CODE" -ne 0 ]]; then
  echo "== 빌드 실패 — 스테이징 제거, 실행 중 .next 유지 =="
  rm -rf "$STAGING_DIR"
  if [[ "$MYSQL_WAS_STOPPED" == "1" ]]; then
    run systemctl start mysql
    MYSQL_WAS_STOPPED=0
    sleep 1
  fi
  if [[ "$PM2_STOPPED_FOR_BUILD" == "1" ]]; then
    pm2 restart "$PM2_APP" 2>/dev/null || pm2 start "$PM2_APP" 2>/dev/null || true
  fi
  exit "$BUILD_CODE"
fi

if [[ ! -d "$STAGING_DIR" ]]; then
  if [[ -f .next/BUILD_ID ]] && [[ -d .next/static/chunks ]]; then
    echo "== ${STAGING_DIR} 없음 — .next 에 빌드됨, 교체 생략 =="
    verify_build_output ".next" || exit 1
  else
    echo "== 빌드 산출물 없음: ${STAGING_DIR} (.next 도 불완전) =="
    exit 1
  fi
else
  verify_build_output "$STAGING_DIR" || exit 1
  # ----- .next 교체 (수 ms) — 빌드 완료 후에만 스왑 -----
  echo "== .next 교체 (기존 빌드 → .next.old) =="
  rm -rf .next.old
  if [[ -d .next ]]; then
    mv .next .next.old
  fi
  mv "$STAGING_DIR" .next
fi

if [[ -d "$STAGING_DIR" ]] || [[ -f .next/BUILD_ID ]]; then
  :
else
  exit 1
fi

echo "== 서비스 재기동 (reload — 교체 구간만 수 초) =="
if [[ ! -d .next ]]; then
  echo "== .next 없음 =="
  exit 1
fi

if [[ "$MYSQL_WAS_STOPPED" == "1" ]]; then
  echo "== MySQL 기동 =="
  run systemctl start mysql
  MYSQL_WAS_STOPPED=0
  sleep 1
fi

# nginx
if systemctl list-unit-files nginx.service >/dev/null 2>&1; then
  bash "$ROOT/deploy/ec2-nginx-static-fix.sh" 2>/dev/null || true
  run systemctl start nginx 2>/dev/null || true
  run systemctl reload nginx 2>/dev/null || true
fi

clear_pm2_build_env() {
  unset NEXT_BUILD_DIR NEXT_USE_STAGING_DIST || true
  export NEXT_BUILD_DIR="" NEXT_USE_STAGING_DIST=""
  pm2 unset "$PM2_APP" NEXT_BUILD_DIR 2>/dev/null || true
  pm2 unset "$PM2_APP" NEXT_USE_STAGING_DIST 2>/dev/null || true
}

reload_pm2_app() {
  clear_pm2_build_env
  cd "$ROOT"
  if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    echo "== pm2 reload ${PM2_APP} =="
    pm2 reload "$PM2_APP" --update-env 2>/dev/null || pm2 restart "$PM2_APP" --update-env
    return $?
  fi
  echo "== pm2 최초 기동 ${PM2_APP} =="
  free_listen_port "$PORT"
  NEXT_BUILD_DIR= NEXT_USE_STAGING_DIST= pm2 start npm --name "$PM2_APP" -- start
  return $?
}

start_pm2_app_fresh() {
  clear_pm2_build_env
  pm2 stop "$PM2_APP" 2>/dev/null || true
  pm2 delete "$PM2_APP" 2>/dev/null || true
  free_listen_port "$PORT"
  cd "$ROOT"
  NEXT_BUILD_DIR= NEXT_USE_STAGING_DIST= pm2 start npm --name "$PM2_APP" -- start
  return $?
}

if ! reload_pm2_app; then
  echo "== pm2 reload 실패 — .next 롤백 후 fresh start =="
  rm -rf .next
  if [[ -d .next.old ]]; then
    mv .next.old .next
  fi
  start_pm2_app_fresh || true
  exit 1
fi
pm2 save 2>/dev/null || true

rm -rf .next.old "$STAGING_DIR"
if [[ "$DEPLOY_FAST" != "1" ]]; then
  npm cache clean --force 2>/dev/null || true
fi

# ----- 빌드 후 스왑 -----
if [[ "$KEEP_SWAP" != "1" ]] && [[ "$SWAP_CREATED_BY_US" == "1" || "${FORCE_REMOVE_SWAP:-0}" == "1" ]]; then
  echo "== 빌드 후 스왑 제거 (디스크 절약) =="
  run swapoff "$SWAP_FILE" 2>/dev/null || true
  run rm -f "$SWAP_FILE"
fi

# ----- 헬스 -----
echo "== health =="
sleep $([[ "$DEPLOY_FAST" == "1" ]] && echo 1 || echo 2)
HEALTH_OK=0
for i in 1 2 3 4 5; do
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
    echo " health OK"
    HEALTH_OK=1
    break
  fi
  sleep 1
done
if [[ "$HEALTH_OK" != "1" ]]; then
  echo " health check 실패 — pm2 logs ${PM2_APP} 확인"
  pm2 logs "$PM2_APP" --lines 30 --nostream 2>/dev/null || true
  exit 1
fi

if ! verify_state_api "$PORT"; then
  echo "== /api/state 스모크 실패 — zombie·MySQL·pm2 logs 확인 =="
  pm2 logs "$PM2_APP" --lines 30 --nostream 2>/dev/null || true
  systemctl is-active mysql 2>/dev/null || true
  exit 1
fi

OBS_TEXT_CODE="$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/overlay/obs-text?u=finalent&host=obs&textId=default" || echo "000")"
echo "overlay/obs-text HTTP ${OBS_TEXT_CODE}"

if ! verify_static_serving; then
  echo "== static 자산 검증 실패 — pm2 reload 1회 재시도 =="
  reload_pm2_app || start_pm2_app_fresh || true
  sleep 4
  if ! verify_static_serving; then
    echo "== static 재시도 실패 — pm2 logs ${PM2_APP} 확인 =="
    df -h / | awk 'NR==1 || /root|\/$/'
    pm2 logs "$PM2_APP" --lines 20 --nostream 2>/dev/null || true
    echo "  bash deploy/ec2-recover-youtube.sh"
    echo "  브라우저: Ctrl+Shift+R 후 재접속"
    exit 1
  fi
fi

echo "== 상태 =="
df -h / | awk 'NR==1 || /root|\/$/'
free -h | head -2
pm2 status "$PM2_APP" || true
systemctl is-active mysql 2>/dev/null && echo "mysql: active" || echo "mysql: $(systemctl is-active mysql 2>/dev/null || echo unknown)"

trap - ERR

if [[ "$DEPLOY_FAST" == "1" ]]; then
  echo "== DEPLOY_FAST=1 — 워치독·cron 재등록 생략 =="
else
  echo "== 안정성 (워치독·일일 정리·pm2 startup) =="
  bash "$ROOT/deploy/ec2-setup-stability.sh" 2>/dev/null || echo "WARN: ec2-setup-stability 실패 — 수동: bash deploy/ec2-setup-stability.sh"
fi

echo "=========================================="
echo " 배포 완료 — 빌드 중 서비스 유지, 교체 구간만 reload"
echo "=========================================="
