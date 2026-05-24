# 시그 판매 오버레이 로컬 테스트

## 준비

```bash
cd youtube-git
npm install
npm run dev
```

브라우저 기본 주소: `http://localhost:3000`

로컬·LAN에서는 루트(`/`)가 **`/overlay/sig-sales`** 로 연결됩니다. 짧은 주소는 **`/wheel`** (동일하게 통합 오버레이).

관리자 화면은 **`http://localhost:3000/admin`** 에서 로그인 후 사용합니다.

## 휠 데모 20칸 (로컬 전용 · 라이브 서버 미저장)

`wheel_demo_*` id 시그 20개는 **localhost·LAN** 에서만 회전판에 씁니다. `saveState`·`/api/state` 저장 시 자동 제거되어 Render 등 프로덕션 Redis에는 들어가지 않습니다.

| 용도 | URL |
|------|-----|
| **확정 시그 ↔ 착지 정합 점검(권장)** | `http://localhost:3000/wheel` 또는 `http://localhost:3000/overlay/sig-sales/wheel-demo` |
| 5회 자동 연속 | 위 URL + `?auto=1` |
| 통합 오버레이+데모 | `http://localhost:3000/overlay/sig-sales?u=finalent&wheelDemo=1&menuCount=20&wheelDemoWins=5&wheelDemoAuto=1` |

### 정합 점검 페이지 (`/wheel-demo`) 사용법

목적: **서버(또는 데모)에서 확정한 당첨 시그**와 **회전판이 멈춘 칸(포인터 아래 라벨)** 이 일치하는지 확인합니다. 프로덕션과 동일한 `bindWheelAnimationToRoundWinner` · `resolveWheelSlicesForSpinVisual` 경로를 씁니다.

1. `npm run dev` 후 **`http://localhost:3000/wheel`** 접속
2. 우측 **시나리오** 선택  
   - `서로 다른 5종` — 중복 없이 5회  
   - `동일 시그 2연속` / `3연속` — 같은 시그가 휠에 여러 칸일 때 재사용 칸 선택 검증  
   - `무작위` — 매 세션마다 다른 5종
3. **「1회차 스핀」** → 착지 후  
   - 상단: **확정 시그** vs **착지 라벨**  
   - 우측 로그: `OK` / `FAIL`, 목표 칸 번호·착지 칸 번호  
   - 20칸 맵: 목표 칸 하이라이트
4. **「다음 회차」** 로 2~5회차 반복 (5회 후 요약)
5. `?auto=1` 이면 착지 후 자동으로 다음 회차 스핀

통합 오버레이(`wheelDemoAuto=1`)는 연출·한방 시그 카드까지 포함한 **풀 데모**이며, 메타마스크 등 SES 확장이 있으면 `next/image` 번들 충돌로 검은 화면이 날 수 있어 **정합만 볼 때는 `/wheel` 권장**합니다.

관리자 **`/admin/sig-sales`** 는 로컬에서 열면 OBS URL에 `wheelDemo=1` 이 자동으로 붙습니다.

## 통합 오버레이 URL

회전·당첨은 서버 **`/api/roulette/spin`** 과 저장 상태를 따릅니다. 로컬에서 보려면 API·Redis(또는 동일한 `/api/state` 백엔드)가 붙어 있어야 하며, 관리자 대시보드에서 복사하는 **`/overlay/sig-sales?u=…&menuCount=…`** 형태의 URL을 쓰면 됩니다.

### 튜닝 쿼리 (선택)

| 파라미터 | 의미 |
|----------|------|
| `sequentialCardEmergeMs` | 한 라운드 `result` 후 카드 +1까지(ms) |
| `sequentialNextSpinMs` | 다음 회전 시작까지(ms) |
| `resultRevealDelayMs` | 최종 착지 후 휠 페이드·카드 게이트(ms) |

예:

```
http://localhost:3000/overlay/sig-sales?u=YOUR_USER_ID&menuCount=5&sequentialCardEmergeMs=350&sequentialNextSpinMs=1200
```

## 참고

- 연출 로직은 `src/app/overlay/sig-sales/page.tsx` 에서 순차 라운드·카드 슬라이스를 처리합니다.
- OBS에서는 시그 오버레이 **브라우저 소스 하나**만 쓰는지, 예전처럼 엑셀/별도 텍스트 소스가 겹치지 않는지도 확인하세요.
