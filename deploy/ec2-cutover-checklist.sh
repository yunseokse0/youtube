#!/usr/bin/env bash
# 컷오버 체크리스트 — 환경변수로 대상 지정 후 단계별 안내·검증
# 사용:
#   NEW_HOST=x.x.x.x OLD_HOST=13.209.47.158 KEY=~/.ssh/key.pem \
#     bash deploy/ec2-cutover-checklist.sh
set -euo pipefail

NEW_HOST="${NEW_HOST:-}"
OLD_HOST="${OLD_HOST:-13.209.47.158}"
KEY="${KEY:-}"
SSH_USER="${SSH_USER:-ubuntu}"
UPLOAD_ROOT="${SIG_UPLOADS_DATA_DIR:-/var/lib/DIN}"


echo "=========================================="
echo " youtube EC2 컷오버 체크리스트"
echo "=========================================="
echo "OLD_HOST=${OLD_HOST}"
echo "NEW_HOST=${NEW_HOST:-"(미설정)"}"
echo ""

step() { echo ""; echo "---- $1 ----"; }

step "1) 새 서버 헬스"
if [[ -n "$NEW_HOST" ]]; then
  curl -sI --max-time 10 "http://${NEW_HOST}/api/health" | head -n 8 || echo "FAIL: health"
else
  echo "NEW_HOST 설정 후: curl -sI http://\$NEW_HOST/api/health"
fi

step "2) Upstash Redis"
echo "새 서버 .env 의 UPSTASH_REDIS_REST_URL / TOKEN 이 기존과 동일하면 상태(멤버·후원)가 이어집니다."
echo "SSH에서: grep UPSTASH ~/youtube/.env"

step "3) 시그 파일 rsync (옛 → 새)"
if [[ -n "$NEW_HOST" && -n "$KEY" ]]; then
  echo "실행 예시(로컬 또는 점프에서):"
  cat <<EOF
rsync -avz -e "ssh -i ${KEY} -o StrictHostKeyChecking=accept-new" \\
  ${SSH_USER}@${OLD_HOST}:${UPLOAD_ROOT}/uploads/ \\
  ${SSH_USER}@${NEW_HOST}:${UPLOAD_ROOT}/uploads/
EOF
  echo "(실제 rsync는 확인 후 수동 실행 — 이 스크립트는 삭제성 명령을 자동 실행하지 않음)"
else
  echo "KEY·NEW_HOST 설정 시 rsync 예시가 출력됩니다."
  echo "rsync -avz -e 'ssh -i KEY' ubuntu@OLD:${UPLOAD_ROOT}/uploads/ ubuntu@NEW:${UPLOAD_ROOT}/uploads/"
fi

step "4) OBS·북마크 URL"
echo "관리자/오버레이 URL을 Elastic IP(NEW_HOST)로 교체"
echo "예: http://${NEW_HOST:-<NEW_IP>}/admin"
echo "예: http://${NEW_HOST:-<NEW_IP>}/overlay?p=...&u=..."

step "5) MySQL (localhost)"
echo "새 서버에서:"
echo "  mysql -u youtube_app -p -h 127.0.0.1 youtube -e 'SELECT 1'"
echo "  sudo ss -lntp | grep 3306   # 127.0.0.1 만"
echo "  보안그룹에 3306 인바운드가 없는지 AWS 콘솔 확인"

step "6) 스모크"
echo "- 로그인"
echo "- 엑셀표·후원 합계"
echo "- 시그 이미지 미리보기"
echo "- OBS 오버레이 1개"

step "7) 옛 인스턴스"
echo "확인 완료 후에만 OLD(${OLD_HOST}) 중지/종료"
echo "AWS 콘솔 → EC2 → Instance state → Stop instance"
echo "Elastic IP는 새 인스턴스에만 연결 유지"

echo ""
echo "=== 체크리스트 출력 완료 ==="
echo "문서: deploy/EC2-MySQL-setup.md"
