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
