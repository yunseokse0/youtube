# EC2 저메모리(1GB) 빌드 — 인스턴스 업그레이드 없이

`npm run build` 중 **JavaScript heap out of memory** 가 나면 RAM+스왑 부족입니다.  
아래 **방법 A(서버 빌드)** 또는 **방법 B(PC 빌드 후 업로드)** 중 하나를 쓰세요.

---

## 방법 A — EC2에서 빌드 (권장, 1회 스왑 설정)

### 1) 스왑 2GB (재부팅 후에도 유지, **1회만**)

`fallocate: Text file busy` → **`/swapfile`이 이미 있음**. 새로 만들지 말고 아래만 실행:

```bash
swapon --show
free -h
```

Swap이 2G 정도 보이면 **스왑 설정은 끝**. `fallocate` 다시 하지 마세요.

스왑이 0이면:

```bash
sudo swapon /swapfile
# 또는
cd ~/youtube   # 실제 프로젝트 경로 (youtube6 이면 그쪽)
sudo bash deploy/ec2-setup-swap.sh
```

### 2) 배포 (pull + 빌드 + pm2)

```bash
cd ~/youtube6   # 또는 ~/youtube — 실제 clone 경로
bash deploy/deploy-on-ec2.sh
```

또는 수동:

```bash
cd ~/youtube6
git pull
rm -rf .next
PM2_APP=youtube NODE_HEAP_MB=2048 npm run build:prod
curl -I http://127.0.0.1:3000/api/health
```

`build:prod` 는 다음을 합니다.

- 빌드 전 `pm2 stop youtube` (RAM 확보)
- `NODE_OPTIONS=--max-old-space-size=2048`
- `LOW_MEMORY_BUILD=1` → Next 워커 1개로 피크 메모리 완화
- 빌드 후 `pm2 restart youtube`

### 3) 여전히 OOM 이면

```bash
NODE_HEAP_MB=1536 PM2_APP=youtube npm run build:prod
```

또는 빌드 전 다른 프로세스 확인: `htop` / `pm2 stop all`

---

## 방법 B — PC에서 빌드, `.next`만 서버에 복사

서버 RAM이 부족할 때 **로컬(Windows)에서 빌드** 후 산출물만 올립니다.

### PC (프로젝트 폴더)

```powershell
cd D:\excel\youtube-git
git pull
npm ci
npm run build
```

### 서버로 `.next` 전송 (SSH 키·IP는 본인 환경에 맞게)

```powershell
scp -r .next ubuntu@43.200.177.132:~/youtube/
```

### 서버

```bash
cd ~/youtube
git pull          # 소스는 맞추고 .next는 PC 빌드본 유지
pm2 restart youtube
curl -I http://127.0.0.1:3000/api/health
```

주의: **PC와 서버 Node 버전**이 크게 다르면 드물게 `.next` 호환 문제가 날 수 있습니다.  
가능하면 둘 다 Node 20 LTS.

---

## 방법 C — GitHub Actions에서 빌드 (선택)

EC2 대신 GitHub runner(메모리 충분)에서 `npm run build` 후 `.next`를 scp/rsync.  
`EC2_HOST`, `EC2_SSH_KEY` 등 시크릿 설정이 필요합니다. (워크플로는 필요 시 추가)

---

## 요약

| 방법 | 장점 | 단점 |
|------|------|------|
| A 스왑 + build:prod | 서버만으로 완결 | 첫 swap 설정, 빌드 5~15분 |
| B PC → scp .next | 서버 OOM 회피 | PC 필요, Node 버전 맞출 것 |
| 인스턴스 업그레이드 | 빌드 빠름 | 비용 증가 (사용 안 함) |

기존 문서의 `git pull && npm run build` 는 **`bash deploy/deploy-on-ec2.sh`** 또는 **`npm run build:prod`** 로 바꾸는 것을 권장합니다.
