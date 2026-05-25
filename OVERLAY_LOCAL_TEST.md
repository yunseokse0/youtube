# 시그 판매 오버레이 로컬 테스트

## 준비

```bash
cd youtube-git
npm install
npm run dev
```

**`Cannot find module './xxxx.js'` / 500 / 흰 화면** → dev 서버를 끄고:

```bash
npm run dev:clean
```

브라우저 **Ctrl+Shift+R**(시크릿 창 권장).

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

## 대전 연출 · 통합 점검 (식사 + 시그)

식사 대전 게이지 연출과 시그 대전 VS UI를 **한 허브**에서 모두 고를 수 있습니다.

| 용도 | URL |
|------|-----|
| **통합 허브 (권장)** | `http://localhost:3000/overlay/battle-effects-demo` |
| **UI 반영 확인 (체크리스트)** | `http://localhost:3000/overlay/battle-effects-demo/verify` |
| 식사 대전만 | `http://localhost:3000/overlay/meal-match/gauge-demo` |
| 시그 대전만 | `http://localhost:3000/overlay/sig-match/demo` |

### UI 반영 확인 (v3)

요청 레이아웃이 적용됐는지 한 페이지에서 검증합니다.

1. `npm run dev` 후 **`/overlay/battle-effects-demo/verify`** 접속
2. 식사·시그 iframe 각각 확인 → 체크리스트 체크
3. **DEMO · v3** 뱃지가 보이면 새 UI 번들 로드됨 (안 보이면 Ctrl+Shift+R)
4. 진행 **N / N 전체 통과** 시 반영 완료

| 확인 항목 | 식사 대전 | 시그 대전 |
|-----------|-----------|-----------|
| 타이틀 | 「식사 대전」 | 「시그 대전」 |
| 점수 위치 | 게이지 **막대 안** (`62 / 100`) | 멤버 행에 **이름 + 72 시그** |
| 멤버 배치 | 이름 pill **막대 아래** | 좌·우 **세로** 목록 |
| 구 UI 아님 | 점수가 막대 밖만 있음 ✗ | `멤버1·멤버2` 가로 한 줄 ✗ |

직접 URL (허브 미리보기용 `hubPreview=1` 포함):

- 식사: `http://localhost:3000/overlay/meal-match?demo=true&fx=all&gaugePreview=1&demoTimerSec=15&hubPreview=1&scalePct=90`
- 시그: 통합 허브 → **시그 2팀 대결 · 자동 연출** 선택 (snap URL 자동 생성)

## 식사 대전 · 게이지 연출 점검

서버·Redis 없이 URL만으로 연출을 확인합니다. 관리자 **식사 대전 → 게이지 연출** 체크박스는 `/api/state` 저장값이며, 아래 URL의 `fx` / `timerTheme` 이 있으면 **URL이 우선**합니다.

| 용도 | URL |
|------|-----|
| **연출 허브 (시나리오·iframe)** | `http://localhost:3000/overlay/meal-match/gauge-demo` |
| **통합 허브** | `http://localhost:3000/overlay/battle-effects-demo` |
| 연출 전체 + 자동 점수·타이머 | `http://localhost:3000/overlay/meal-match?demo=true&fx=all&gaugePreview=1&demoTimerSec=15` |
| 연출 OFF 비교 | `http://localhost:3000/overlay/meal-match?demo=true&fx=none` |
| neon 타이머 | `http://localhost:3000/overlay/meal-match?demo=true&timerTheme=neon&fx=timer&gaugePreview=1&demoTimerSec=12` |
| 팀 분할 게이지 | `http://localhost:3000/overlay/meal-match?demo=true&demoMode=team&fx=all&gaugePreview=1` |

### URL 파라미터

| 파라미터 | 의미 |
|----------|------|
| `demo=true` | 데모 참가자·점수 (필수) |
| `demoMode` | `member` \| `team` \| `individual` |
| `fx` / `gaugeFx` | `all` \| `none` \| `critical,floating,rank,timer` |
| `timerTheme` | `default` \| `neon` \| `minimal` \| `danger` |
| `gaugePreview=1` | 3초마다 점수 변동·리더 교체, 로컬 타이머 카운트다운 |
| `fx` … `motion` | 게이지 막대 스프링·맥동·채움 끝 하이라이트 (`gaugeMotion`, 기본 ON) |
| `demoTimerSec` | gaugePreview 타이머 시작 초 (기본 15) |

단위 테스트: `npm test -- src/lib/meal-gauge-effects.test.ts`

## 시그 대전 (시그 판매·회전판과 별도)

후원·시그 키워드로 **팀/개인 점수 대결** — OBS 경로는 `/overlay/sig-match` 입니다. 시그 판매 회전판(`/overlay/sig-sales`)과 다릅니다.

| 용도 | URL |
|------|-----|
| **통합 허브 (권장)** | `http://localhost:3000/overlay/battle-effects-demo` |
| **시그 대전 데모 허브** | `http://localhost:3000/overlay/sig-match/demo` |
| 실시간 (서버·Redis) | `http://localhost:3000/overlay/sig-match?u=finalent` |
| 관리자 | `http://localhost:3000/admin` → 「시그 대전 관리」·하단 iframe 미리보기 |

데모 허브는 `snap` 쿼리로 멤버·풀·점수·타이머를 넣어 서버 없이 표시합니다. `sigPreview=1` 이면 3초마다 시그 점수가 변해 VS 막대·공동 목표바·리드 스윕을 확인할 수 있습니다.

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
