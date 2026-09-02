# EC2 Instance Connect — 긴급 배포 (SSH 키 없이)

**증상**: admin 502, `/api/state` 타임아웃, 어제 푸시한 수정이 서버에 반영 안 됨  
**원인**: GitHub `main` ≠ EC2 `~/youtube` (배포·마이그레이션 미실행)

---

## 0. 접속 (1분)

1. [AWS 콘솔](https://ap-northeast-2.console.aws.amazon.com/ec2/) → **EC2** → **인스턴스**
2. IP `13.125.178.141` 인스턴스 선택
3. **연결** → **EC2 Instance Connect** → **연결**
4. 검은 터미널이 뜨면 아래 **한 블록씩** 붙여넣기

---

## 1. 응급 복구 + 패치 배포 (한 번에)

```bash
set -e
cd ~/youtube || { git clone https://github.com/yunseokse0/youtube.git ~/youtube && cd ~/youtube; }
git fetch origin main
git reset --hard origin/main
git log -1 --oneline

echo "== PM2/Node 복구 =="
bash deploy/ec2-recover-youtube.sh || true
pm2 status || true

echo "== daily-log 23MB 긴급 청소 + shard 마이그레이션 + 빌드 배포 =="
bash deploy/ec2-emergency-daily-log-cleanup.sh --user=din

echo "== nginx (502 완화) =="
bash deploy/ec2-nginx-reset-youtube.sh || true

echo "== 검증 =="
sleep 5
curl -sf --max-time 10 "http://127.0.0.1:3000/api/health?deep=1" | head -c 300; echo
curl -sf --max-time 15 -w "\nstate fast HTTP:%{http_code} time:%{time_total}s\n" \
  "http://127.0.0.1:3000/api/state?user=din&u=din&fast=1&_t=$(date +%s)" -o /dev/null || echo "state FAIL"
mysql --protocol=socket -u youtube_app -p"$(grep '^password=' /etc/mysql/youtube-app.cnf 2>/dev/null | cut -d= -f2)" youtube -N -e \
  "SELECT k, CHAR_LENGTH(v) bytes FROM app_kv WHERE k LIKE 'excel-broadcast-daily-log-v1:din%' ORDER BY bytes DESC LIMIT 6;" 2>/dev/null || echo "mysql skip"
pm2 logs youtube --lines 15 --nostream 2>/dev/null || true
```

**기대**: `git log`에 `e2b71c8` 또는 `daily-log shard` 커밋, state fast **2초 이내**, daily-log monolith **수 KB stub**

---

## 2. 1번이 실패할 때 (단계별)

### A) Node만 먼저

```bash
cd ~/youtube && git pull
pm2 restart youtube --update-env
curl -s -o /dev/null -w "HTTP:%{http_code}\n" http://127.0.0.1:3000/api/health
```

502면:

```bash
bash ~/youtube/deploy/ec2-recover-youtube.sh
```

### B) DB만 먼저 (23MB I/O 차단)

```bash
cd ~/youtube && git pull
node scripts/migrate-daily-log-shards.mjs --user=din --dry-run
node scripts/migrate-daily-log-shards.mjs --user=din
pm2 restart youtube
```

### C) 빌드만 (코드 반영)

```bash
cd ~/youtube && git pull
bash deploy/ec2-apply-mysql-root-fix.sh
```

---

## 3. 브라우저 확인

- `http://13.125.178.141/admin` — 새로고침 (Ctrl+Shift+R)
- DevTools Network: `/api/state?fast=1` **200**, 2초 이내

---

## 4. 여전히 느리면

현재 서버 RAM/디스크 한계 → **Ubuntu 22.04 t3.large 신규 + Elastic IP**  
→ `deploy/EC2-MySQL-setup.md` · `deploy/ec2-cutover-checklist.sh`

---

## 5. 터미널 출력 공유

아래만 복사해 개발 채팅에 붙이면 다음 조치 가능:

```bash
cd ~/youtube && git log -1 --oneline && pm2 status && free -h && df -h /
```
