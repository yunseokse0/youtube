# EC2 신규 + 동일 서버 MySQL 설정

youtube(엑셀 방송) 앱용 EC2를 새로 만들고, **같은 인스턴스에 MySQL 8**을 `127.0.0.1` 전용으로 둡니다.  
앱 **상태 저장은 MySQL** (`DATABASE_URL`) — `app_kv` 테이블. Upstash Redis는 쓰지 않아도 됩니다(설정 시 Redis 우선).

```
Browser/OBS → :80 Nginx → :3000 Next(pm2) → MySQL 127.0.0.1:3306 (app_kv)
```

## 스펙 (기본)

| 항목 | 값 |
|------|-----|
| 리전 | `ap-northeast-2` (서울) |
| AMI | Ubuntu Server 22.04 LTS |
| 인스턴스 | `t3.medium` (2 vCPU / 4GB) — Next 빌드 + MySQL 공존 |
| 디스크 | gp3 **8GB** (기본). 시그·MySQL 늘면 부족할 수 있음 → 콘솔에서 확장 |
| 보안 그룹 | `22` = 본인 IP만, `80` = 전체, **`3306` 열지 않음** |
| IP | **Elastic IP** 필수 |

1GB 인스턴스는 OOM 위험이 큽니다. 저메모리 대응: [EC2-저메모리-빌드.md](./EC2-저메모리-빌드.md)

---

## 1. EC2 생성

### A) AWS CLI (권장)

로컬에 [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) 설치 후:

**Linux / macOS / Git Bash**

```bash
aws configure   # Access Key, region=ap-northeast-2

export KEY_NAME=내키페어이름
export MY_IP="$(curl -s https://checkip.amazonaws.com)/32"
bash deploy/ec2-create-instance.sh
```

**Windows PowerShell**

```powershell
aws configure

$env:KEY_NAME = "내키페어이름"
$env:MY_IP = (Invoke-RestMethod https://checkip.amazonaws.com).Trim() + "/32"
powershell -ExecutionPolicy Bypass -File deploy/ec2-create-instance.ps1
```

출력된 Elastic IP로 SSH:

```bash
ssh -i /path/to/key.pem ubuntu@<ElasticIP>
```

### B) AWS 콘솔

1. EC2 → Launch instance (서울)
2. Ubuntu 22.04, `t3.medium` (2/4GB), gp3 **8GB**, 키 페어 선택
3. 보안 그룹: SSH(내 IP), HTTP(0.0.0.0/0), **MySQL 미개방**
4. Elastic IP 할당 → 인스턴스 Associate

---

## 2. 런타임 + MySQL (서버에서)

```bash
sudo apt update && sudo apt install -y git
git clone <이-레포-URL> ~/youtube
cd ~/youtube

# Upstash 등 필수 값 채우기
cp .env.example .env
nano .env
```

`.env` 필수 예:

```env
ADMIN_ACCOUNTS_KEY=DIN
AUTH_COOKIE_SECURE=false
SIG_UPLOADS_DATA_DIR=/var/lib/DIN
# MySQL은 bootstrap이 생성·기입 (또는 아래를 수동 설정)
# DATABASE_URL=mysql://youtube_app:...@127.0.0.1:3306/youtube
```

저장 후:

```bash
bash deploy/ec2-bootstrap.sh
```

`ec2-bootstrap.sh`가 하는 일:

- apt / Node 20 / pm2 / nginx / ufw / 스왑
- `/var/lib/DIN/uploads/sigs` 생성
- Nginx (`nginx-youtube.conf.example` + 업로드 35M)
- **MySQL 8** (`ec2-setup-mysql.sh`) — 생략: `SKIP_MYSQL=1`
- `.env`에 `DATABASE_URL`이 있으면 `deploy-on-ec2.sh` 빌드·pm2

MySQL만 다시:

```bash
MYSQL_APP_PASSWORD='강한비번' bash deploy/ec2-setup-mysql.sh
```

검증:

```bash
mysql -u youtube_app -p -h 127.0.0.1 youtube -e "SELECT 1"
sudo ss -lntp | grep 3306    # 127.0.0.1 만 LISTEN
curl -sI http://127.0.0.1:3000/api/health
```

### DATABASE_URL

`.env` 예시 (스크립트가 자동 기입):

```env
DATABASE_URL=mysql://youtube_app:<PASSWORD>@127.0.0.1:3306/youtube
```

앱이 `DATABASE_URL`로 상태·계정·후원 큐 등을 MySQL `app_kv`에 저장합니다.

원격 GUI는 SSH 터널만:

```bash
ssh -i key.pem -L 3306:127.0.0.1:3306 ubuntu@<ElasticIP>
```

---

## 3. 백업

`ec2-setup-mysql.sh`가 등록:

- `/usr/local/bin/youtube-mysql-backup.sh`
- cron `/etc/cron.d/youtube-mysql-backup` (매일 03:15, 14일 보관)
- 인증: `/etc/mysql/youtube-app.cnf` (권한 600)

수동: `sudo /usr/local/bin/youtube-mysql-backup.sh`

---

## 4. 컷오버 (기존 `13.209.47.158` 대체)

```bash
NEW_HOST=<새ElasticIP> OLD_HOST=13.209.47.158 KEY=~/.ssh/key.pem \
  bash deploy/ec2-cutover-checklist.sh
```

Windows:

```powershell
$env:NEW_HOST = "<새ElasticIP>"
$env:OLD_HOST = "13.209.47.158"
$env:KEY = "$env:USERPROFILE\.ssh\key.pem"
powershell -ExecutionPolicy Bypass -File deploy/ec2-cutover-checklist.ps1
```

요약:

1. 새 IP `/api/health` · 로그인 · 오버레이 스모크  
2. `.env` `DATABASE_URL`이 MySQL을 가리키면 새 서버에 상태가 쌓입니다(옛 서버 Upstash와는 별개 — 이전 시 별도 마이그레이션)  
3. 시그 rsync: 옛 `/var/lib/finalent/uploads/` 또는 `/var/lib/DIN/uploads/` → 새 `/var/lib/DIN/uploads/`  
4. OBS·북마크 URL을 새 Elastic IP로 교체  
5. 확인 후 옛 인스턴스 중지  

시그·Nginx 세부: [EC2-시그-이미지-업로드.md](./EC2-시그-이미지-업로드.md)

---

## 5. 안정성 (디스크 100%·502/500 재발 방지)

**원인 요약:** 디스크가 100% 차면 MySQL·Node가 쓰기 실패 → `POST /api/state` 500 → pm2 다운 → Nginx **502**.

git pull 후 **1회** 설치:

```bash
cd ~/youtube && bash deploy/ec2-setup-stability.sh
```

| 구성 | 역할 |
|------|------|
| `ec2-setup-daily-disk-clean.sh` | 매일 04:10 — PM2·journal·binlog 정리 |
| `ec2-setup-watchdog.sh` | **5분마다** — 디스크 ≥85% 정리, ≥92% 강화 정리, health 실패 시 `ec2-recover-youtube` |
| `ec2-setup-pm2-startup.sh` | **재부팅 후** pm2 자동 기동 |

`deploy-on-ec2.sh` 배포 시 위 설정도 자동 재등록됩니다.

확인:

```bash
tail -n 30 /var/log/youtube-watchdog.log
df -h /
curl -s "http://127.0.0.1:3000/api/health?deep=1"
```

디스크 진단(삭제 없음): `bash deploy/ec2-disk-report.sh`  
긴급 수동: `bash deploy/ec2-free-disk.sh` → `bash deploy/ec2-recover-youtube.sh`

---

## 스크립트 목록

| 파일 | 역할 |
|------|------|
| `ec2-create-instance.sh` | AMI·SG·t3.medium·gp3 8GB·Elastic IP (AWS CLI / Bash) |
| `ec2-create-instance.ps1` | 동일 (Windows PowerShell) |
| `ec2-bootstrap.sh` | OS·Node·nginx·스왑·업로드·MySQL·배포 |
| `ec2-setup-mysql.sh` | MySQL bind localhost · DB/유저 · cron 백업 |
| `ec2-cutover-checklist.sh` | 컷오버 점검 안내 (Bash) |
| `ec2-cutover-checklist.ps1` | 컷오버 점검 안내 (PowerShell) |
| `deploy-on-ec2.sh` | git pull · 스테이징 빌드(서비스 유지) · .next 교체 · pm2 reload |
| `ec2-setup-swap.sh` | 스왑 2GB |
| `ec2-nginx-upload-limit.sh` | `client_max_body_size 35M` |
| `ec2-setup-stability.sh` | 일일 정리 + 워치독 + pm2 startup 일괄 |
| `ec2-watchdog.sh` | 5분 cron 본체 (디스크·health·recover) |
| `ec2-free-disk.sh` | 디스크 정리 (manual/daily) |
| `ec2-recover-youtube.sh` | 502·EADDRINUSE 긴급 복구 |
| `ec2-emergency-recover.sh` | recover 실패·HTTP 무응답 — MySQL·Node·nginx 전면 재기동 |
| `ec2-mysql-stabilize.sh` | 저메모리 MySQL 튜닝 + 재시작 |
| `ec2-stabilize-mysql-and-static.sh` | **MySQL 안정화 + static HTTP 200 + pm2** 한 번에 |

---

## 주의

- 보안 그룹·ufw에 **3306 인바운드를 열지 마세요.**
- `.env`·키 페어·DB 비밀번호는 Git에 커밋하지 마세요.
- MySQL로 앱 상태를 저장합니다 (`app_kv`). Upstash는 선택(있으면 Redis 우선).
