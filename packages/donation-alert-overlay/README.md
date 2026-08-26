# @finalent/donation-alert-overlay

OBS·방송용 **후원 출력(도네이션 얼럿)** 모듈. React UI + 큐 + 순수 변환 로직만 포함하며, **데이터 소스(SSE·API)는 호스트 앱이 연결**합니다.

## 폴더 복사

다른 프로젝트에 붙일 때:

```text
packages/donation-alert-overlay/   ← 이 폴더 전체 복사
```

### 의존성 (peer)

- `react` / `react-dom` >= 18
- `framer-motion` >= 10 (애니메이션 버전만, 선택)
- Tailwind CSS (카드 스타일 — 없으면 className 오버라이드)

### tsconfig paths 예시

```json
{
  "compilerOptions": {
    "paths": {
      "@donation-alert-overlay": ["packages/donation-alert-overlay/src/index.ts"],
      "@donation-alert-overlay/*": ["packages/donation-alert-overlay/src/*"]
    }
  }
}
```

## 빠른 시작 (Next.js / React)

```tsx
"use client";

import { useMemo } from "react";
import {
  AnimatedDonationAlertOverlay,
  useDonationAlertQueue,
  createManualDonationAlertSource,
  DONATION_ALERT_TEST_ITEM,
} from "@donation-alert-overlay";

export default function DonationAlertPage() {
  const testMode = true; // ?test=true 로 분기

  const source = useMemo(() => {
    if (testMode) return null;
    const manual = createManualDonationAlertSource();
    // TODO: WebSocket / fetch 폴링 / SSE 에서 manual.push(item) 호출
    return manual;
  }, [testMode]);

  const { current, enqueueAlert } = useDonationAlertQueue({
    testItem: testMode ? DONATION_ALERT_TEST_ITEM : null,
    source,
  });

  return <AnimatedDonationAlertOverlay current={current} />;
}
```

## API

| export | 설명 |
|--------|------|
| `DonationAlertShowItem` | 알림 1건 타입 |
| `donationAlertFromAppliedHint` | SSE/이벤트 페이로드 → 알림 |
| `donationAlertFromDonorRecord` | donor 레코드 → 알림 |
| `donationAlertsFromUnseenDonors` | 폴링 신규 감지 |
| `buildDonationAlertUrl` | OBS URL 생성 (`basePath` 커스터마이즈) |
| `DonationAlertSource` | `{ subscribe(onAlert) => unsubscribe }` |
| `createManualDonationAlertSource` | 수동 push / 테스트 |
| `mergeDonationAlertSources` | SSE + 폴링 합치기 |
| `useDonationAlertQueue` | 표시 큐 React 훅 |
| `DonationAlertCard` | 카드 UI만 |
| `DonationAlertOverlay` | CSS 애니메이션 셸 |
| `AnimatedDonationAlertOverlay` | framer-motion 셸 |

## DonationAlertSource 구현 예

```ts
import type { DonationAlertSource, DonationAlertShowItem } from "@donation-alert-overlay";

export function createMyApiSource(userId: string): DonationAlertSource {
  return {
    subscribe(onAlert) {
      const ws = new WebSocket(`wss://api.example.com/donations?u=${userId}`);
      ws.onmessage = (ev) => {
        const item = JSON.parse(ev.data) as DonationAlertShowItem;
        onAlert(item);
      };
      return () => ws.close();
    },
  };
}
```

## 라벨·경로 커스터마이즈

```tsx
<DonationAlertCard
  alert={item}
  labels={{
    accountTarget: "Bank",
    toonTarget: "Super Chat",
    contribution: "Points",
  }}
  locale="en-US"
/>

buildDonationAlertUrl("user1", {
  basePath: "/live/donation-alert",
  extraParams: { theme: "dark" },
});
```

## youtube(본 저장소) 연동

- 패키지: `packages/donation-alert-overlay/`
- 앱 어댑터: `src/lib/donation-alert/youtube-broadcast-source.ts` (폴링 + `/api/state`)
- 페이지: `src/app/overlay/donation-alert/page.tsx` (SSE + 훅)

## 테스트

```bash
npx vitest run packages/donation-alert-overlay/src/core.test.ts
```
