# OBS 텍스트 오버레이 — 되돌리기 가이드

현재 `main`의 SSE·폴링·동기화 수정( `af83a93` ~ `HEAD` )이 방송에 맞지 않을 때, **텍스트 오버레이 기능이 들어간 시점**으로 되돌릴 때 쓰세요.

## 권장 되돌림 지점

| Git ref | 커밋 | 설명 |
|---------|------|------|
| **`obs-text-baseline`** (권장) | `fc68fe7` | 텍스트 오버레이 + 자동 저장·서버 동기화까지. **이후 SSE/502/실시간 패치 전** |
| `obs-text-added` | `81feda1` | 텍스트 **다중 인스턴스**·관리자 편집 추가 직후 (자동 저장 패치 전) |
| `obs-text-first` | `72527f9` | OBS 텍스트 오버레이 **최초** 도입 |

되돌리면 **사라지는 것**(대략): 판매완료 도장 OBS 동기화(`191dadc`), 최근 텍스트 SSE·`/push` 라우트·시그 깜빡임 패치 등 `fc68fe7` 이후 커밋 전부.

---

## 서버(EC2)에서 한 번에 되돌리기

```bash
cd ~/youtube   # 실제 프로젝트 경로

# 1) 지금 main 백업 (나중에 다시 올릴 때)
git fetch origin
git branch backup/main-before-rollback-$(date +%Y%m%d) origin/main

# 2) 권장 지점으로 체크아웃 (읽기 전용 확인용)
git checkout obs-text-baseline
npm run build
pm2 restart youtube

# 문제 없으면 main을 그 커밋으로 맞추려면 (팀 합의 후):
# git checkout main
# git reset --hard obs-text-baseline
# git push origin main --force-with-lease   # ⚠️ force — 혼자 쓰는 저장소일 때만
```

`--force-with-lease` 없이 **임시로만** 쓰려면 태그만 배포:

```bash
git fetch origin tag obs-text-baseline
git checkout obs-text-baseline
rm -rf .next && npm run build && pm2 restart youtube
```

---

## 로컬에서 main만 되돌리기 (개발 PC)

```bash
git fetch origin
git checkout main
git reset --hard obs-text-baseline
# 원격 main도 맞출 때만:
# git push origin main --force-with-lease
```

다시 최신으로:

```bash
git checkout main
git reset --hard origin/main
```

---

## OBS URL (되돌린 뒤에도 동일)

```
http://<서버IP>/overlay/obs-text?u=finalent&host=obs&textId=<인스턴스id>
```

- 포트 **80** (nginx), `:3000` 직접 접속은 피하세요.
- `host=obs` 는 되돌린 버전에서도 URL 복사에 포함하는 것이 좋습니다.

---

## 현재 main과의 차이 보기

```bash
git log --oneline obs-text-baseline..origin/main
git diff --stat obs-text-baseline..origin/main
```

---

## 태그 목록

- `obs-text-baseline` → `fc68fe7`
- `obs-text-added` → `81feda1`
- `obs-text-first` → `72527f9`

태그는 `git push origin --tags` 로 원격에 올려 두었습니다.
