import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { AppState, Donor } from "@/types";
import { defaultState } from "@/lib/state";
import { sanitizeDonationEventFromIngestBody } from "@/lib/donation/din-ingest";
import { foldIngestEventsIntoState } from "@/lib/din-ingest-batch-fold";
import {
  offerDinExcelIngest,
  resetDinIngestBatchQueueForTests,
} from "@/lib/din-ingest-batch-queue";
import { getDinIngestStore } from "@/lib/din-ingest-pending";
import { applyOverlayDonationDisplayTotals } from "@/lib/overlay-donation-aggregate";
import type { DonorAlias } from "@/lib/donation/types";

describe("Toona ➔ YouTube 유입 후원 Burst (고밀도 동시 폭주) E2E 정합성 검증", () => {
  beforeEach(() => {
    resetDinIngestBatchQueueForTests();
  });

  const createBaseState = (): AppState => ({
    ...defaultState(),
    members: [
      { id: "m1", name: "영실", account: 0, toon: 0, contribution: 0, goal: 20000000 },
      { id: "m2", name: "얼음", account: 0, toon: 0, contribution: 0, goal: 20000000 },
      { id: "m3", name: "수린", account: 0, toon: 0, contribution: 0, goal: 20000000 },
      { id: "m4", name: "초화", account: 0, toon: 0, contribution: 0, goal: 20000000 },
    ],
    donors: [],
  });

  const aliases: DonorAlias[] = [
    { id: "a1", alias: "얼미", memberId: "m2" },
    { id: "a2", alias: "영시리", memberId: "m1" },
    { id: "a3", alias: "쑤린", memberId: "m3" },
  ];

  // =========================================================================
  // 1. Toona S2S 60건 비동기 동시 전송 (Concurrent Push Burst)
  // =========================================================================
  it("시나리오 1: Toona에서 60건의 서로 다른 후원이 밀리초 간격으로 동시 발송될 때 YouTube에서 누락 0건으로 전수 수신·적재된다", () => {
    const baseState = createBaseState();
    const count = 60;
    const members = ["영실", "얼음", "수린", "초화"];

    // Toona의 forwardToYoutubeGit 페이로드 형태 모델링
    const toonaPayloads = Array.from({ length: count }, (_, i) => ({
      id: `bank:sms:toona_burst_${String(i).padStart(3, "0")}`,
      externalId: `toona_burst_${String(i).padStart(3, "0")}`,
      donorName: `투나팬_${i}`,
      amount: 10000 + (i * 1000), // 10,000원 ~ 69,000원
      playerName: members[i % 4],
      message: `투나 응원 #${i} !!`,
      provider: "bank",
      target: "account",
      at: new Date(1795167000000 + i * 5).toISOString(),
    }));

    // YouTube 수신부 sanitize
    const sanitizedEvents = toonaPayloads.map((p) => {
      const ev = sanitizeDonationEventFromIngestBody(p);
      expect(ev).not.toBeNull();
      return ev!;
    });

    // YouTube 배치 적재
    const foldResult = foldIngestEventsIntoState(baseState, sanitizedEvents, aliases);

    expect(foldResult.applied.length).toBe(count);
    expect(foldResult.duplicates).toBe(0);
    expect(foldResult.unmatched.length).toBe(0);
    expect(foldResult.state.donors?.length).toBe(count);

    // 총 금액 계산 검증: 10000 * 60 + 1000 * (59 * 60 / 2) = 600,000 + 1,770,000 = 2,370,000원
    const expectedTotal = 600000 + 1770000;
    const actualDonorSum = (foldResult.state.donors || []).reduce((acc, d) => acc + (d.amount || 0), 0);
    expect(actualDonorSum).toBe(expectedTotal);

    const actualMemberSum = foldResult.state.members.reduce((acc, m) => acc + (m.account || 0), 0);
    expect(actualMemberSum).toBe(expectedTotal);
  });

  // =========================================================================
  // 2. Toona 집계(Aggregated) 버킷 유입 폭주 (Batch Aggregator Burst)
  // =========================================================================
  it("시나리오 2: Toona의 3초 Aggregation Window에서 묶인 집계 버킷(5건 묶음 등)이 폭주 유입될 때 집계 금액과 후원자 정보가 유실 없이 전액 반영된다", () => {
    const baseState = createBaseState();

    // Toona _flushBucket에서 생성하는 type: 'aggregated' 구조 10개 (각 5건씩 총 50건 상당)
    const aggregatedBuckets = Array.from({ length: 10 }, (_, bIdx) => {
      const subEvents = Array.from({ length: 5 }, (_, sIdx) => ({
        id: `evt:b${bIdx}:s${sIdx}`,
        donorName: `집계팬_${bIdx}_${sIdx}`,
        amount: 20000,
        message: `메시지_${bIdx}_${sIdx}`,
      }));
      const totalAmount = subEvents.reduce((s, e) => s + e.amount, 0); // 100,000원
      const donors = subEvents.map((e) => e.donorName);
      const messages = subEvents.map((e) => e.message);

      return sanitizeDonationEventFromIngestBody({
        id: `agg:toona_${bIdx}:5`,
        externalId: `agg:toona_${bIdx}:5`,
        donorName: `${donors[0]} 외 4명`,
        amount: totalAmount,
        playerName: "얼음",
        provider: "bank",
        target: "account",
        message: messages.slice(0, 3).join(" / "),
        aggregatedCount: 5,
        aggregatedDonors: donors,
        aggregatedMessages: messages,
        aggregatedEventIds: subEvents.map((e) => e.id),
        at: new Date(1795167100000 + bIdx * 20).toISOString(),
      })!;
    });

    const foldResult = foldIngestEventsIntoState(baseState, aggregatedBuckets, aliases);

    expect(foldResult.applied.length).toBe(10);
    expect(foldResult.state.donors?.length).toBe(10);

    // 총 10개 버킷 x 100,000원 = 1,000,000원
    const m2 = foldResult.state.members.find((m) => m.id === "m2");
    expect(m2?.account).toBe(1000000);
    expect(m2?.contribution).toBe(1000000);

    // 첫 번째 버킷의 집계 정보 보존 확인
    const firstDonor = foldResult.state.donors?.[9]; // timestamp 정렬
    expect(firstDonor?.amount).toBe(100000);
  });

  // =========================================================================
  // 3. Toona ExternalRetry 재전송과 신규 후원의 동시 유입 레이스
  // =========================================================================
  it("시나리오 3: Toona의 ExternalRetry 워커가 재전송한 20건과 신규 후원 20건이 동시에 레이스로 쏟아져도 신규만 정확히 반영되고 재전송은 1회만 유지된다", () => {
    const baseState = createBaseState();
    const count = 20;

    // 이미 어제/방금 전송되어 원장에 존재하는 과거 후원 20건
    const existingPastDonors: Donor[] = Array.from({ length: count }, (_, i) => ({
      id: `bank:sms:past_${String(i).padStart(3, "0")}`,
      externalId: `past_${String(i).padStart(3, "0")}`,
      name: `과거팬_${i}`,
      donorName: `과거팬_${i}`,
      amount: 15000,
      memberId: "m3",
      at: 1795160000000 + i * 10,
      target: "account",
    }));

    const stateWithPast: AppState = {
      ...baseState,
      donors: existingPastDonors,
      members: baseState.members.map((m) =>
        m.id === "m3" ? { ...m, account: count * 15000, contribution: count * 15000 } : m
      ),
    };

    // Toona ExternalRetry가 재전송 시도하는 과거 20건
    const retryEvents = existingPastDonors.map((d) =>
      sanitizeDonationEventFromIngestBody({
        id: d.id,
        externalId: d.externalId,
        donorName: d.donorName,
        amount: d.amount,
        playerName: "수린",
        provider: "bank",
        at: new Date(d.at!).toISOString(),
      })!
    );

    // 동시에 Toona를 통해 실시간 유입되는 신규 후원 20건
    const freshEvents = Array.from({ length: count }, (_, i) =>
      sanitizeDonationEventFromIngestBody({
        id: `bank:sms:fresh_${String(i).padStart(3, "0")}`,
        externalId: `fresh_${String(i).padStart(3, "0")}`,
        donorName: `신규팬_${i}`,
        amount: 30000,
        playerName: "수린",
        provider: "bank",
        at: new Date(1795167200000 + i * 10).toISOString(),
      })!
    );

    // 재전송 20건 + 신규 20건이 교차 혼합되어 동시 40건 유입
    const burstStream: typeof freshEvents = [];
    for (let i = 0; i < count; i++) {
      burstStream.push(retryEvents[i]);
      burstStream.push(freshEvents[i]);
    }

    const foldResult = foldIngestEventsIntoState(stateWithPast, burstStream, aliases);

    // 과거 재전송 20건은 duplicates로 안전 차단, 신규 20건만 applied!
    expect(foldResult.applied.length).toBe(count);
    expect(foldResult.duplicates).toBe(count);
    // 최종 donors는 기존 20건 + 신규 20건 = 총 40건
    expect(foldResult.state.donors?.length).toBe(40);

    const m3 = foldResult.state.members.find((m) => m.id === "m3");
    // 기존 (20 x 15,000 = 300,000) + 신규 (20 x 30,000 = 600,000) = 900,000원 정확 일치!
    expect(m3?.account).toBe(900000);
  });

  // =========================================================================
  // 4. Toona 777데이 룰렛 당첨/꽝 초당 다건 폭주 유입
  // =========================================================================
  it("시나리오 4: Toona에서 777데이 룰렛 스핀 16건(당첨 10건, 꽝 6건)이 초당 폭주 유입 시 메인 12,432,000원 전액과 퐁당 당첨 시그 기여도만 완벽 분리된다", () => {
    const baseState = createBaseState();
    const totalCount = 16;
    const winCount = 10;
    const missCount = 6;
    const winSigPrices = [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000];

    const toona777Events = Array.from({ length: totalCount }, (_, i) => {
      const isWin = i < winCount;
      const sigPrice = isWin ? winSigPrices[i] : undefined;

      return sanitizeDonationEventFromIngestBody({
        id: `bank:sms:toona_777_${String(i).padStart(3, "0")}`,
        externalId: `toona_777_${String(i).padStart(3, "0")}`,
        donorName: `룰렛도전자_${i}`,
        amount: 777000,
        playerName: "초화",
        provider: "bank",
        ...(isWin ? { sigPrice, isSigCredit: true, matchedSigName: `시그_${sigPrice}` } : {}),
        message: isWin ? `당첨 축하! ${sigPrice}원 시그` : "아쉽게 꽝 ㅠㅠ",
        at: new Date(1795167300000 + i * 10).toISOString(),
      })!;
    });

    const foldResult = foldIngestEventsIntoState(baseState, toona777Events, aliases);
    expect(foldResult.applied.length).toBe(totalCount);

    // 메인 엑셀표 (day777Calc: false): 777,000 x 16 = 12,432,000원
    const mainExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: false });
    const mainM4 = mainExcel.members.find((m) => m.id === "m4");
    expect(mainM4?.account).toBe(totalCount * 777000);
    expect(mainM4?.contribution).toBe(totalCount * 777000);

    // 퐁당퐁당 엑셀표 (day777Calc: true): 계좌 12,432,000원 전액 보존 + 기여도는 당첨 10건 시그 단가 합만
    const pongdangExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
    const pongdangM4 = pongdangExcel.members.find((m) => m.id === "m4");
    expect(pongdangM4?.account).toBe(totalCount * 777000); // 실제 입금 원금 전액 보존!

    // 당첨 시그 합: 10000 + 20000 + ... + 100000 = 550,000원
    const expectedSigTotal = winSigPrices.reduce((a, b) => a + b, 0);
    expect(pongdangM4?.contribution).toBe(expectedSigTotal); // 550,000원 정확 일치! (꽝 6건 기여도 0원 완벽 방어)
  });
});
