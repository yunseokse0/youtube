# EC2 시그 이미지 업로드 · IP 변경

## 시그 추가 시 이미지가 하는 일

1. 관리자에서 GIF/PNG 등 선택
2. `POST /api/upload/sig-image?user=<계정ID>` 로 서버에 전송
3. 서버가 파일 저장 후 **경로만** 반환: `/uploads/sigs/finalent/1738xxxx_abc.gif`
4. 시그 목록 `imageUrl`에 위 경로 저장 → **「현재 설정 저장」** 시 `/api/state`에 기록
5. OBS·롤링은 **지금 접속한 주소(IP)** + `/uploads/sigs/...` 또는 `/api/uploads-sigs/...` 로 이미지 표시

**IP가 바뀌어도** 저장 URL은 상대 경로라서, **새 IP로 관리자에 다시 접속**하면 같은 파일을 볼 수 있습니다.  
(단, 파일이 서버 디스크에 실제로 남아 있어야 함)

## EC2 재시작·IP 변경 시 자주 생기는 문제

| 증상 | 원인 | 조치 |
|------|------|------|
| 관리자 자체가 안 열림 | 북마크가 **옛 IP** | AWS 콘솔에서 **새 퍼블릭 IP**로 접속 |
| 업로드는 됐는데 미리보기 404 | 파일이 `public/uploads`만 쓰이고 `git pull`/빌드로 삭제됨 | **영구 경로** 사용 (아래) |
| 업로드 413 | Nginx 기본 1MB | `client_max_body_size 35M` |
| 업로드 401 | 로그인 만료 | 새 IP에서 다시 로그인 |
| OBS만 깨짐 | OBS 소스 URL이 **옛 IP** | OBS 브라우저 소스 URL을 새 IP로 수정 |

## 권장: Elastic IP (고정 IP)

EC2를 재시작해도 IP가 안 바뀌게 **Elastic IP**를 인스턴스에 연결하세요.  
(.env.example에도 동일 안내)

## 권장: 업로드 영구 저장

```bash
sudo mkdir -p /var/lib/finalent/uploads/sigs
sudo chown -R ubuntu:ubuntu /var/lib/finalent   # 실제 실행 사용자로 변경
```

`.env` (선택, 미설정 시 Linux 프로덕션은 `/var/lib/finalent` 자동 시도):

```env
SIG_SERVE_SIG_IMAGES_FROM_DISK=true
SIG_UPLOADS_DATA_DIR=/var/lib/finalent
```

**끄기:** `NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY=true` 이면 디스크 업로드 URL이 Git 경로로 바뀌어 404가 납니다. EC2 디스크 업로드 시 **반드시 끄세요.**

## 배포 후 확인

```bash
git pull && npm run build && pm2 restart youtube
curl -I http://127.0.0.1:3000/api/health
ls -la /var/lib/finalent/uploads/sigs/finalent/ | head
```

Nginx SSE·업로드: `deploy/nginx-youtube.conf.example` 참고.
