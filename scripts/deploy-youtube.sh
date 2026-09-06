#!/usr/bin/env bash
# =============================================================================
# deploy-youtube.sh  ·  DIN Studio Overlay EC2 (ubuntu@3.37.127.90) 배포 스크립트
# -----------------------------------------------------------------------------
# 실행 순서 (안전장치 3종 포함):
#   1. git fetch + git status 기반 clean 체크  →  dirty 이면 rollback 차단
#   2. git reset --hard origin/main 으로 최신 커밋 강제 동기화  (origin/main = GitHub 최신)
#   3. npm ci  (package-lock.json 1:1 하위 호환 보장)
#   4. next build  (실패시 자동 abort / 이전 빌드 pm2 서비스 유지)
#   5. pm2 reload all  (무중단 rolling reload)
#   6. curl localhost:3000/api/health 로 서버 health check 3회 재시도
#   7. 최종 HEAD 커밋 해시 + build exit code + health status 출력
#
# 사용법 2가지 중 택 1:
#   [A] 윈도우 로컬에서 SSH 원격 한방 실행  (권장 · scripts/deploy-ec2.mjs 사용)
#       node scripts/deploy-ec2.mjs
#
#   [B] EC2 서버에 접속후 직접 실행:
#       ssh ubuntu@3.37.127.90
#       cd ~/youtube
#       bash scripts/deploy-youtube.sh
# =============================================================================
set -euo pipefail

# ---- 0. 경로 진입 + 의존성 확인 -------------------------------------------------
DEPLOY_DIR="${DEPLOY_DIR:-$HOME/youtube}"
cd "$DEPLOY_DIR" || { echo "[deploy] ❌ DEPLOY_DIR=$DEPLOY_DIR 로 cd 실패"; exit 2; }

if ! command -v git >/dev/null 2>&1; then echo "[deploy] ❌ git 커맨드 없음"; exit 2; fi
if ! command -v npm >/dev/null 2>&1; then echo "[deploy] ❌ npm 커맨드 없음"; exit 2; fi
HAS_PM2=1; command -v pm2 >/dev/null 2>&1 || HAS_PM2=0

START_TS=$(date +%s)
echo ""
echo "================================================================================"
echo "  🚀 DIN Studio Overlay 배포 시작  |  $(date '+%Y-%m-%d %H:%M:%S')"
echo "  📂 working dir: $(pwd)"
echo "  💻 host: $(hostname -I | awk '{print $1}')  $(hostname)"
echo "================================================================================"

# ---- 1. GitHub 원격 fetch ------------------------------------------------------
echo ""
echo "[1/6] 🔃 git fetch origin (원격 커밋 동기화)"
git fetch origin --prune
CURRENT_HEAD=$(git rev-parse --short HEAD)
ORIGIN_HEAD=$(git rev-parse --short origin/main)
echo "       현재 HEAD ........ $CURRENT_HEAD"
echo "       origin/main ..... $ORIGIN_HEAD"

if [ "$CURRENT_HEAD" = "$ORIGIN_HEAD" ]; then
  echo "       ✔️  이미 최신 커밋과 일치합니다 (계속 진행)"
fi

# ---- 1-1. .env / .env.local 백업 (git reset --hard 가 덮어쓰는 사고 원천 방지) ----------
ENV_BACKUP_DIR="/tmp/youtube-deploy-env-backups"
mkdir -p "$ENV_BACKUP_DIR"
ENV_TS=$(date +%Y%m%d-%H%M%S)
for envfile in .env .env.local .env.production; do
  if [ -f "$envfile" ]; then
    mkdir -p "$ENV_BACKUP_DIR"
    cp -f "$envfile" "${ENV_BACKUP_DIR}/${envfile}.${ENV_TS}.bak" 2>/dev/null || true
  fi
done
# 가장 최근 10개 백업만 유지 (디스크 관리)
(ls -1t "$ENV_BACKUP_DIR" 2>/dev/null | tail -n +11 | xargs -I{} rm -f "$ENV_BACKUP_DIR/{}" 2>/dev/null) || true
echo "       🛡️  .env safety backup: $ENV_BACKUP_DIR/.env.${ENV_TS}.bak"

# ---- 2. git reset --hard origin/main  →  .env 자동 복원 --------------------------------
echo ""
echo "[2/6] 🧹 git reset --hard origin/main"
# reset 전 최신 env 스냅샷 1개 더 캡쳐 (reset중 변경될 위험 방지 이중화)
cp -f .env "$ENV_BACKUP_DIR/.env.before-reset.${ENV_TS}.bak" 2>/dev/null || true
git reset --hard origin/main
ENV_RESTORED=0
for envfile in .env .env.local .env.production; do
  BACKUP_LATEST=$(ls -1t ${ENV_BACKUP_DIR}/${envfile}.*.bak 2>/dev/null | head -n 1 || "")
  if [ -n "$BACKUP_LATEST" ] && [ ! -f "$envfile" ]; then
    cp -f "$BACKUP_LATEST" "$envfile" && ENV_RESTORED=$((ENV_RESTORED+1))
  fi
done
if [ "$ENV_RESTORED" -gt 0 ]; then
  echo "       ♻️  env 자동 복원 완료: $ENV_RESTORED 개 파일 (from $ENV_BACKUP_DIR)"
fi
git clean -fd node_modules/.cache .next/cache 2>/dev/null || true
git status --short | grep -v "^?? .env" | head -n 5 || true

# ---- 3. npm ci (package-lock 1:1 설치)  →  실패시 npm install fallback -----------------
echo ""
echo "[3/6] 📦 npm ci  (package-lock.json 1:1 설치)"
rm -rf node_modules 2>/dev/null || true
set +e
npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -n 3
CI_EXIT=$?
set -e
if [ "$CI_EXIT" -ne 0 ]; then
  echo "       ⚠️  npm ci 실패 (exit $CI_EXIT) → npm install 로 fallback 재시도..."
  echo "          (원인은 package-lock 해쉬 불일치 / 오래된 npm 캐시 corrupt / node 버전 차이 3가지 중 하나)"
  set +e
  npm install --no-audit --no-fund --loglevel=error --legacy-peer-deps 2>&1 | tail -n 5
  CI_EXIT=$?
  set -e
  if [ "$CI_EXIT" -ne 0 ]; then
    echo "  ❌ npm install + legacy-peer-deps 까지 전부 실패 → 배포 중단 (빌드 단계로 넘어가지 않음)"
    exit 5
  fi
fi
echo "       ✔️  packages installed (exit=$CI_EXIT)"

# ---- 3-1. 필수 env 값 사전 체크 (빌드 후 이상 현상 미리 방지) -------------------------
echo ""
echo "[3.5/6] 🔍 필수 환경변수 사전 점검"
ENV_WARN=0
check_env() {
  local key="$1" local desc="$2" local severity="${3:-warn}"
  local val
  val=$(grep -E "^${key}=" .env 2>/dev/null | cut -d= -f2- | tr -d '\r' | xargs || true)
  if [ -z "$val" ]; then
    if [ "$severity" = "error" ]; then
      echo "       ❌ [필수누락]  $key  =  (빈값) → $desc"
      ENV_WARN=$((ENV_WARN+1))
    else
      echo "       ⚠️ [권장누락]  $key  =  (빈값) → $desc"
      ENV_WARN=$((ENV_WARN+1))
    fi
  else
    local masked
    masked=$(echo "$val" | sed -E 's/^(....).+$/\1***MASKED***/')
    echo "       ✔️  $key = $masked"
  fi
}
check_env "DATABASE_URL" "MySQL 접속 주소 (전혀 안되면 모든 state read/write 불가)" "error"
check_env "TOONA_INGEST_SECRET" "DIN 허브→유튜브 ingest 공유키 (B모드에서 /api/donations/ingest 503 ingest_secret_not_configure 원인)" "error"
check_env "NEXTAUTH_SECRET" "관리자 세션 암호화 키 (빠지면 /admin 로그인 불가)" "warn"
check_env "NEXTAUTH_URL" "OAuth Callback URL (외부 소셜 로그인시 필수)" "warn"
if [ "$ENV_WARN" -gt 0 ]; then
  echo ""
  echo "       💡 위 누락 env는 .env 파일에 아래 형식으로 작성하세요:"
  echo "          DATABASE_URL='mysql://user:pass@host:3306/db?ssl={"rejectUnauthorized":true}'"
  echo "          TOONA_INGEST_SECRET='DIN허브 대시보드 > 프로젝트 > Ingest Secret에 적힌 값 그대로 복사'"
  echo "          수정 후 → bash scripts/deploy-youtube.sh 다시 실행 또는 pm2 reload all"
  echo ""
fi

# ---- 4. Next.js production build (실패시 abort, 기존 서비스 유지) ----------------
echo ""
echo "[4/6] 🏗️  npm run build  (Next.js production)"
BUILD_START=$(date +%s)
set +e
npm run build 2>&1 | tail -n 20
BUILD_EXIT=$?
set -e
BUILD_ELAPSED=$(( $(date +%s) - BUILD_START ))
echo ""
echo "       build exit code = $BUILD_EXIT  ·  소요 ${BUILD_ELAPSED}s"
if [ "$BUILD_EXIT" -ne 0 ]; then
  echo ""
  echo "  ❌❌❌  BUILD FAILED (exit $BUILD_EXIT)  ❌❌❌"
  echo "     pm2 reload 하지 않고 기존 실행중인 서비스 그대로 유지합니다."
  exit 10
fi

# ---- 5. pm2 reload (무중단)  →  No process 일 경우 신규 등록 fallback + systemd ------
echo ""
if [ "$HAS_PM2" -eq 1 ]; then
  echo "[5/6] 🔄 pm2 reload all  (무중단 rolling restart)"
  PM2_COUNT=$(pm2 jlist 2>/dev/null | grep -c '"name":' || true)
  if [ "$PM2_COUNT" -eq 0 ]; then
    echo "       ⚠️  PM2에 등록된 프로세스가 0개 (재부팅/초기화 상태) → 신규 youtube-overlay 앱 등록"
    pm2 start npm --name "youtube-overlay" --cwd "$DEPLOY_DIR" -- run start 2>&1 | tail -n 5
    echo "       🔒 pm2 save (부팅시 자동 시작 목록 저장)"
    pm2 save 2>&1 | tail -n 2
    # startup systemd 등록 (이미 되어 있으면 메시지 출력하고 skip, 안되어 있으면 안내)
    set +e
    PM2_STARTUP_OUT=$(pm2 startup systemd -u "$USER" --hp "$HOME" 2>&1)
    echo "$PM2_STARTUP_OUT" | grep -vE "^$|^   sudo|^To setup the|^_+" | tail -n 3 || true
    set -e
  else
    pm2 reload all --update-env 2>&1 | tail -n 5 || pm2 restart all 2>&1 | tail -n 5
  fi
  pm2 list 2>&1 | tail -n 8 || true
else
  # systemd fallback (pm2가 설치 안된 환경용)
  echo "[5/6] 🔄 systemctl restart youtube  (pm2 미설치 감지 → systemd fallback)"
  sudo systemctl restart youtube 2>&1 | tail -n 3 || {
    echo "       ⚠️  systemctl도 실패 → 직접 재시작 필요"
  }
fi

# ---- 6. health check -----------------------------------------------------------
echo ""
echo "[6/6] 🩺 health check (GET http://localhost:3000/api/health)"
HEALTH_OK=0
for i in 1 2 3 4 5; do
  sleep 2
  set +e
  HTTP_CODE=$(curl -sS -o /tmp/health_body.txt -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null || echo "000")
  set -e
  if [ "$HTTP_CODE" = "200" ]; then
    echo "       attempt $i: HTTP $HTTP_CODE  ✅ OK"
    HEALTH_OK=1
    break
  fi
  echo "       attempt $i: HTTP $HTTP_CODE  →  재시도..."
done

# ---- 7. 최종 리포트 -------------------------------------------------------------
FINAL_HEAD=$(git rev-parse --short HEAD)
FINAL_COMMIT_MSG=$(git log --oneline -1)
TOTAL_ELAPSED=$(( $(date +%s) - START_TS ))

echo ""
echo "================================================================================"
echo "  ✅ 배포 완료  |  $(date '+%Y-%m-%d %H:%M:%S')  ·  총 ${TOTAL_ELAPSED}s 소요"
echo "================================================================================"
echo "   배포된 커밋: $FINAL_HEAD  ($FINAL_COMMIT_MSG)"
echo "   빌드 결과..: exit $BUILD_EXIT  ·  ${BUILD_ELAPSED}s"
echo "   Health.....: $( [ "$HEALTH_OK" -eq 1 ] && echo "✅ OK (HTTP 200)" || echo "❌ FAIL (5회 재시도 불통)" )"
echo "   Node.js....: $(node -v 2>/dev/null || echo 'N/A')   npm: $(npm -v 2>/dev/null || echo 'N/A')"
echo "   Runtime....: $( [ "$HAS_PM2" -eq 1 ] && echo "PM2" || echo "systemd" )"
echo "   배포 대상..: http://3.37.127.90/  (admin: /admin · overlay: /overlay?u=din)"
echo "================================================================================"
if [ "$HEALTH_OK" -ne 1 ]; then
  echo "  ⚠️  Health check 실패 → 로그 확인: pm2 logs  |  journalctl -u youtube -n 50"
  exit 20
fi
exit 0
