# 시그 판매 오버레이 로컬 테스트

## 준비

```bash
cd youtube-git
npm install
npm run dev
```

브라우저 기본 주소: `http://localhost:3000`

## 바로 회전판 테스트 (한 번에 열기)

개발 서버 실행 후 **아래 주소만** 열면 데모 회전판이 자동으로 시작합니다.

```
http://localhost:3000/overlay/sig-sales/demo
```

→ `/overlay/sig-sales` 로 리다이렉트되며 `rouletteDemo=1`, `menuCount=5`, `devSequentialTest=1` 가 붙습니다.

## 순차 연출만 보기 (서버·Redis 없이)

아래 URL을 열면 데모 풀에서 5개를 뽑고, **회전 5번 → 카드 한 장씩** 흐름이 재생됩니다.

**느리게 보기(로컬 검증용):** `devSequentialTest=1` 을 붙이면 라운드 간격·카드 등장이 조금 늘어납니다.

```
http://localhost:3000/overlay/sig-sales?u=demo&rouletteDemo=1&menuCount=5&devSequentialTest=1
```

- `u` : 오버레이 유저 id (아무 문자열, API 없을 때 placeholder)
- `rouletteDemo=1` : 데모 시그 풀 + 자동 1회차 시작
- `menuCount=5` : 휠 칸 수(기본도 5 이상)
- `devSequentialTest=1` : 로컬에서 연출 타이밍만 완화 (선택)

### 튜닝 쿼리 (선택)

| 파라미터 | 의미 |
|----------|------|
| `sequentialCardEmergeMs` | 한 라운드 `result` 후 카드 +1까지(ms) |
| `sequentialNextSpinMs` | 다음 회전 시작까지(ms) |
| `resultRevealDelayMs` | 최종 착지 후 휠 페이드·카드 게이트(ms) |

예:

```
http://localhost:3000/overlay/sig-sales?u=demo&rouletteDemo=1&menuCount=5&sequentialCardEmergeMs=350&sequentialNextSpinMs=1200
```

## 실서버 상태와 같이 보기

로컬에서 백엔드/API가 붙어 있다면 `rouletteDemo` 없이 일반 오버레이 URL을 쓰면 됩니다. 관리자 대시보드의 `/overlay/sig-sales` 복사 링크와 동일한 방식입니다.

## 참고

- 연출 로직은 `src/app/overlay/sig-sales/page.tsx` 한 곳에서 순차 라운드·카드 슬라이스를 처리합니다.
- OBS에서는 시그 오버레이 **브라우저 소스 하나**만 쓰는지, 예전처럼 엑셀/별도 텍스트 소스가 겹치지 않는지도 확인하세요.
