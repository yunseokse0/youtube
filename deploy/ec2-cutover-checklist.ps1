# 컷오버 체크리스트 (Windows PowerShell)
#   $env:NEW_HOST = "x.x.x.x"
#   $env:OLD_HOST = "13.209.47.158"
#   $env:KEY = "$env:USERPROFILE\.ssh\key.pem"
#   powershell -ExecutionPolicy Bypass -File deploy/ec2-cutover-checklist.ps1

$NewHost = $env:NEW_HOST
$OldHost = if ($env:OLD_HOST) { $env:OLD_HOST } else { "13.209.47.158" }
$Key = $env:KEY
$SshUser = if ($env:SSH_USER) { $env:SSH_USER } else { "ubuntu" }
$UploadRoot = if ($env:SIG_UPLOADS_DATA_DIR) { $env:SIG_UPLOADS_DATA_DIR } else { "/var/lib/DIN" }

Write-Host "=========================================="
Write-Host " youtube EC2 컷오버 체크리스트"
Write-Host "=========================================="
Write-Host "OLD_HOST=$OldHost"
Write-Host "NEW_HOST=$(if ($NewHost) { $NewHost } else { '(미설정)' })"
Write-Host ""

Write-Host "---- 1) 새 서버 헬스 ----"
if ($NewHost) {
  try {
    Invoke-WebRequest -Uri "http://$NewHost/api/health" -Method Head -TimeoutSec 10 | Select-Object StatusCode, StatusDescription
  } catch {
    Write-Host "FAIL: health — $_"
  }
} else {
  Write-Host "NEW_HOST 설정 후: Invoke-WebRequest http://`$env:NEW_HOST/api/health -Method Head"
}

Write-Host ""
Write-Host "---- 2) Upstash Redis ----"
Write-Host "새 서버 .env 의 UPSTASH_REDIS_REST_URL / TOKEN 이 기존과 동일하면 상태가 이어집니다."

Write-Host ""
Write-Host "---- 3) 시그 파일 rsync (옛 → 새) ----"
if ($NewHost -and $Key) {
  Write-Host "Git Bash / WSL 예시:"
  Write-Host "rsync -avz -e `"ssh -i $Key`" ${SshUser}@${OldHost}:${UploadRoot}/uploads/ ${SshUser}@${NewHost}:${UploadRoot}/uploads/"
} else {
  Write-Host "KEY·NEW_HOST 설정 시 rsync 예시가 출력됩니다."
}

Write-Host ""
Write-Host "---- 4) OBS·북마크 URL ----"
$ip = if ($NewHost) { $NewHost } else { "<NEW_IP>" }
Write-Host "http://$ip/admin"
Write-Host "http://$ip/overlay?p=...&u=..."

Write-Host ""
Write-Host "---- 5) MySQL (localhost) ----"
Write-Host "SSH 후: mysql -u youtube_app -p -h 127.0.0.1 youtube -e 'SELECT 1'"
Write-Host "보안그룹에 3306 인바운드 없는지 확인"

Write-Host ""
Write-Host "---- 6) 스모크 ----"
Write-Host "로그인 / 엑셀표 / 시그 미리보기 / OBS 오버레이"

Write-Host ""
Write-Host "---- 7) 옛 인스턴스 ----"
Write-Host "확인 후 OLD($OldHost) 중지. Elastic IP는 새 인스턴스만 유지."
Write-Host ""
Write-Host "문서: deploy/EC2-MySQL-setup.md"
