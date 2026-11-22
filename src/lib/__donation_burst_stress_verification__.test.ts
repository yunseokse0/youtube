import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { AppState, Donor } from "@/types";
import { defaultState } from "@/lib/state";
import { sanitizeDonationEventFromIngestBody } from "@/lib/donation/din-ingest";
import { foldIngestEventsIntoState } from "@/lib/din-ingest-batch-fold";
import {
  offerDinExcelIngest,
  drainDinIngestQueue,
  resetDinIngestBatchQueueForTests,
} from "@/lib/din-ingest-batch-queue";
import { getDinIngestStore } from "@/lib/din-ingest-pending";
import { applyOverlayDonationDisplayTotals } from "@/lib/overlay-donation-aggregate";
import type { DonorAlias } from "@/lib/donation/types";

describe("후원 Burst (고밀도 폭주 유입) 누락 방지 전수 검증", () => {
  beforeEach(() => {
    resetDinIngestBatchQueueForTests();
  });

  const createBaseState = (): AppState => ({
    ...defaultState(),
    members: [
      { id: "m1", name: "영실", account: 0, toon: 0, contribution: 0, goal: 10000000 },
      { id: "m2", name: "얼음", account: 0, toon: 0, contribution: 0, goal: 10000000 },
      { id: "m3", name: "수린", account: 0, toon: 0, contribution: 0, goal: 10000000 },
      { id: "m4", name: "초화", account: 0, toon: 0, contribution: 0, goal: 10000000 },
    ],
    donors: [],
  });

  const aliases: DonorAlias[] = [
    { id: "a1", alias: "얼미", memberId: "m2" },
    { id: "a2", alias: "영시리", memberId: "m1" },
    { id: "a3", alias: "쑤린", memberId: "m3" },
  ];

  // =========================================================================
  // 1. 100건 동시 폭주 유입 (100 Concurrent Ingest Burst)
  // =========================================================================
  it("시나리오 1: 100건의 후원이 동시에 쏟아져 유입될 때 단 1건의 유실도 없이 100건 모두 정산표에 완벽 적재된다", () => {
    const baseState = createBaseState();
    const N = 100;
    const burstEvents = Array.from({ length: N }, (_, i) => {
      const memberIndex = (i % 4) + 1;
      const memberNames = ["영실", "얼음", "수린", "초화"];
      const playerName = memberNames[i % 4];
      const amount = (i + 1) * 1000; // 1,000원 ~ 100,000원

      return sanitizeDonationEventFromIngestBody({
        id: `bank:sms:burst_${String(i).padStart(4, "0")}`,
        externalId: `burst_${String(i).padStart(4, "0")}`,
        donorName: `후원자_${i}`,
        amount,
        playerName,
        provider: "bank",
        message: `폭주 테스트 응원 메시지 #${i}`,
        at: new Date(1795166000000 + i * 10).toISOString(),
      })!;
    });

    // 배치 접기 실행 (foldIngestEventsIntoState)
    const foldResult = foldIngestEventsIntoState(baseState, burstEvents, aliases);

    // 100건 전수 반영 확인
    expect(foldResult.applied.length).toBe(N);
    expect(foldResult.duplicates).toBe(0);
    expect(foldResult.unmatched.length).toBe(0);
    expect(foldResult.state.donors?.length).toBe(N);

    // 전체 후원 총합 일치 검증: sum(1000 ~ 100000) = 1000 * (100 * 101 / 2) = 5,050,000원
    const totalExpected = (N * (N + 1) / 2) * 1000;
    const actualDonorSum = (foldResult.state.donors || []).reduce((acc, d) => acc + (d.amount || 0), 0);
    expect(actualDonorSum).toBe(totalExpected);

    // 멤버 4명의 account 합산 일치 검증
    const memberTotalSum = foldResult.state.members.reduce((acc, m) => acc + (m.account || 0), 0);
    expect(memberTotalSum).toBe(totalExpected);
  });

  // =========================================================================
  // 2. 단일 후원자 고속 연타 버스트 (Same Donor Rapid-fire 30건)
  // =========================================================================
  it("시나리오 2: 동일 후원자가 1초 안에 30번 연속으로 동일 금액을 후원해도 중복 오탐 없이 30건 모두 등록된다", () => {
    const baseState = createBaseState();
    const count = 30;
    const unitAmount = 20000;

    // 동일 후원자 '연타대마왕'이 동일한 금액과 메시지로 30번 연타 (고유 externalId 발급)
    const rapidEvents = Array.from({ length: count }, (_, i) =>
      sanitizeDonationEventFromIngestBody({
        id: `bank:sms:rapid_${String(i).padStart(3, "0")}`,
        externalId: `rapid_${String(i).padStart(3, "0")}`,
        donorName: "연타대마왕",
        amount: unitAmount,
        playerName: "영실",
        provider: "bank",
        message: "연타 후원 간다!!",
        at: new Date(1795166100000 + i * 20).toISOString(),
      })!
    );

    const foldResult = foldIngestEventsIntoState(baseState, rapidEvents, aliases);

    expect(foldResult.applied.length).toBe(count);
    expect(foldResult.duplicates).toBe(0);
    expect(foldResult.state.donors?.length).toBe(count);

    const m1 = foldResult.state.members.find((m) => m.id === "m1");
    expect(m1?.account).toBe(unitAmount * count); // 20,000 x 30 = 600,000원 온전 합산
  });

  // =========================================================================
  // 3. 중복 패킷 폭풍 (Duplicate Packet Storm: 정상 50건 + 중복 50건 = 총 100건)
  // =========================================================================
  it("시나리오 3: 정상 50건과 동일 ID 중복 50건이 뒤섞여 유입될 때 정상 50건만 반영되고 중복 50건은 정확히 방어된다", () => {
    const baseState = createBaseState();
    const N = 50;
    const cleanEvents = Array.from({ length: N }, (_, i) =>
      sanitizeDonationEventFromIngestBody({
        id: `bank:sms:storm_${String(i).padStart(3, "0")}`,
        externalId: `storm_${String(i).padStart(3, "0")}`,
        donorName: `스톰팬_${i}`,
        amount: 10000,
        playerName: "얼음",
        provider: "bank",
        at: new Date(1795166200000 + i * 15).toISOString(),
      })!
    );

    // 동일 ID를 가진 네트워크 재전송 복사본 50건
    const duplicateCopies = cleanEvents.map((e) => ({ ...e }));

    // 정상과 중복을 무작위로 교차 결합 (100건 혼합)
    const mixedStream: typeof cleanEvents = [];
    for (let i = 0; i < N; i++) {
      mixedStream.push(cleanEvents[i]);
      mixedStream.push(duplicateCopies[i]);
    }

    const foldResult = foldIngestEventsIntoState(baseState, mixedStream, aliases);

    expect(foldResult.applied.length).toBe(N); // 정확히 50건만 적용
    expect(foldResult.duplicates).toBe(N);     // 중복 50건 정확히 걸러냄
    expect(foldResult.state.donors?.length).toBe(N);

    const m2 = foldResult.state.members.find((m) => m.id === "m2");
    expect(m2?.account).toBe(N * 10000); // 500,000원 (중복 이중 계상 0건)
  });

  // =========================================================================
  // 4. 777데이 폭주 버스트 (당첨 15건 + 꽝 5건 = 20건 777,000원 동시 유입)
  // =========================================================================
  it("시나리오 4: 777데이 후원 20건(당첨 15건, 꽝 5건)이 폭주할 때 메인표 전액과 퐁당퐁당표 시그 기여도가 오차 없이 분리된다", () => {
    const baseState = createBaseState();
    const count = 20;
    const winCount = 15;
    const kwangCount = 5;

    const events777 = Array.from({ length: count }, (_, i) => {
      const isWin = i < winCount;
      const sigPrice = isWin ? 50000 : undefined; // 당첨 50,000원 / 꽝 undefined

      return sanitizeDonationEventFromIngestBody({
        id: `bank:sms:777_burst_${String(i).padStart(3, "0")}`,
        externalId: `777_burst_${String(i).padStart(3, "0")}`,
        donorName: `럭키러너_${i}`,
        amount: 777000,
        playerName: "초화",
        provider: "bank",
        ...(isWin ? { sigPrice, isSigCredit: true, matchedSigName: "당첨시그" } : {}),
        message: isWin ? `777 5만 시그 당첨! #${i}` : `아쉽게 꽝 #${i}`,
        at: new Date(1795166300000 + i * 20).toISOString(),
      })!;
    });

    const foldResult = foldIngestEventsIntoState(baseState, events777, aliases);
    expect(foldResult.applied.length).toBe(count);

    // ① 메인 엑셀표 (day777Calc: false)
    const mainExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: false });
    const mainM4 = mainExcel.members.find((m) => m.id === "m4");
    // 메인 계좌: 777,000 x 20 = 15,540,000원
    expect(mainM4?.account).toBe(count * 777000);
    // 메인 기여도: 15,540,000원
    expect(mainM4?.contribution).toBe(count * 777000);

    // ② 퐁당퐁당 엑셀표 (day777Calc: true)
    const pongdangExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
    const pongdangM4 = pongdangExcel.members.find((m) => m.id === "m4");
    // 퐁당 계좌 원금: 777,000 x 20 = 15,540,000원 (실제 입금액 100% 보존!)
    expect(pongdangM4?.account).toBe(count * 777000);
    // 퐁당 기여도: 당첨된 15건 x 50,000원 = 750,000원 (꽝 5건 기여도 0원 완전 방어!)
    expect(pongdangM4?.contribution).toBe(winCount * 50000);
  });

  // =========================================================================
  // 5. Ingest Pending 큐 대량 비동기 Enqueue 버스트 (Offer Queue Concurrency)
  // =========================================================================
  it("시나리오 5: Ingest 메모리 대기열에 150건이 동시 offer 될 때 누락 없이 전수 큐에 보관된다", () => {
    const hubUserId = "finalent";
    const stateUserId = "finalent";
    const N = 150;

    for (let i = 0; i < N; i++) {
      const event = sanitizeDonationEventFromIngestBody({
        id: `bank:sms:queue_burst_${String(i).padStart(4, "0")}`,
        externalId: `queue_burst_${String(i).padStart(4, "0")}`,
        donorName: `큐후원자_${i}`,
        amount: 5000,
        playerName: "영실",
        provider: "bank",
        at: new Date(1795166400000 + i * 5).toISOString(),
      })!;

      const offerRes = offerDinExcelIngest(hubUserId, event);
      expect(offerRes.ok).toBe(true);
      expect(offerRes.duplicateQueued).toBe(false);
    }

    const store = getDinIngestStore();
    const queued = store.byUser.get(stateUserId) || [];
    // 150건 모두 대기열에 손실 0건 보관
    expect(queued.length).toBe(N);

    // 동일 ID 재입력 시 duplicateQueued 확인
    const dupEvent = sanitizeDonationEventFromIngestBody({
      id: "bank:sms:queue_burst_0000",
      externalId: "queue_burst_0000",
      donorName: "큐후원자_0",
      amount: 5000,
      playerName: "영실",
      provider: "bank",
    })!;
    const dupRes = offerDinExcelIngest(hubUserId, dupEvent);
    expect(dupRes.duplicateQueued).toBe(true);
    expect(store.byUser.get(stateUserId)?.length).toBe(N); // 큐 크기는 여전히 150 유지
  });
});
