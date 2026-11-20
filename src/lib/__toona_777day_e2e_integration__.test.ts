import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { AppState, Donor, Member } from "@/types";
import { defaultState } from "@/lib/state";
import { toonaHubDonationToEvent, type ToonaHubDonationApiRow } from "@/lib/toona-hub-donation-map";
import { sanitizeDonationEventFromIngestBody } from "@/lib/donation/din-ingest";
import { foldIngestEventsIntoState } from "@/lib/din-ingest-batch-fold";
import { resetDinIngestBatchQueueForTests } from "@/lib/din-ingest-pending";
import { applyOverlayDonationDisplayTotals, collectDay777SigContributionByMember } from "@/lib/overlay-donation-aggregate";

describe("Toona ↔ YouTube 777데이 (day777Calc & 퐁당퐁당 엑셀표) 통합 E2E 검증", () => {
  beforeEach(() => {
    resetDinIngestBatchQueueForTests();
  });

  const createBaseState = (): AppState => ({
    ...defaultState(),
    members: [
      { id: "m1", name: "영실", account: 0, toon: 0, contribution: 0, goal: 1000000 },
      { id: "m2", name: "얼음", account: 0, toon: 0, contribution: 0, goal: 1000000 },
      { id: "m3", name: "수린", account: 0, toon: 0, contribution: 0, goal: 1000000 },
      { id: "m4", name: "초화", account: 0, toon: 0, contribution: 0, goal: 1000000 },
    ],
    donors: [],
  });

  // 1. 777데이 계좌 후원(777,000원) + 시그 단가(50,000원) 전달 시 메인/퐁당퐁당 분리
  it("시나리오 1: Toona에서 777,000원 계좌 후원 + 50,000원 시그 전달 시 메인은 777,000원, 퐁당퐁당은 50,000원으로 정확히 분리된다", () => {
    const ingestEvent = sanitizeDonationEventFromIngestBody({
      id: "bank:sms:777_sig_01",
      externalId: "777_sig_01",
      donorName: "퐁당러버",
      amount: 777000,
      playerName: "얼음",
      provider: "bank",
      sigPrice: 50000,
      isSigCredit: true,
      matchedSigName: "춤시그",
      at: "2026-11-20 18:00:00",
    });

    expect(ingestEvent).not.toBeNull();
    expect(ingestEvent?.sigPrice).toBe(50000);
    expect(ingestEvent?.isSigCredit).toBe(true);

    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [ingestEvent!]);

    expect(foldResult.applied.length).toBe(1);

    // ① 메인 엑셀표 (day777Calc: false)
    const mainExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: false });
    const mainM2 = mainExcel.members.find((m) => m.id === "m2");
    expect(mainM2?.account).toBe(777000);
    expect(mainM2?.contribution).toBe(777000); // 메인은 계좌 전액 인정

    // ② 퐁당퐁당 엑셀표 (day777Calc: true)
    const pongdangExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
    const pongdangM2 = pongdangExcel.members.find((m) => m.id === "m2");
    expect(pongdangM2?.account).toBe(777000);
    expect(pongdangM2?.contribution).toBe(50000); // 퐁당퐁당은 오직 나온 시그 단가만 기여도로 인정!
  });

  // 2. 777데이 룰렛 당첨 시그 후원 (777,000원 원금 + 30,000원 룰렛 시그)
  it("시나리오 2: Toona 룰렛 스핀에서 30,000원 시그 당첨 시 퐁당퐁당 엑셀표에 30,000원 기여도로 반영된다", () => {
    const rouletteEvent = sanitizeDonationEventFromIngestBody({
      id: "bank:sms:777_roulette_02",
      externalId: "777_roulette_02",
      donorName: "룰렛마스터",
      amount: 777000,
      playerName: "수린",
      provider: "bank",
      sigPrice: 30000,
      isSigCredit: true,
      matchedSigName: "애교송",
      at: "2026-11-20 18:10:00",
    });

    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [rouletteEvent!]);

    const pongdangExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
    const pongdangM3 = pongdangExcel.members.find((m) => m.id === "m3");
    expect(pongdangM3?.account).toBe(777000);
    expect(pongdangM3?.contribution).toBe(30000);
  });

  // 3. 시그가 나오지 않은 일반 777,000원 후원 (꽝 또는 일반 후원)
  it("시나리오 3: 시그가 미당첨된 일반 777,000원 후원은 퐁당퐁당 기여도에 0원으로 처리되어 뻥튀기가 발생하지 않는다", () => {
    const plain777Event = sanitizeDonationEventFromIngestBody({
      id: "bank:sms:777_plain_03",
      externalId: "777_plain_03",
      donorName: "일반팬",
      amount: 777000,
      playerName: "초화",
      provider: "bank",
      at: "2026-11-20 18:20:00",
    });

    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [plain777Event!]);

    // 메인 엑셀: 원금 777,000원 반영
    const mainExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: false });
    const mainM4 = mainExcel.members.find((m) => m.id === "m4");
    expect(mainM4?.account).toBe(777000);
    expect(mainM4?.contribution).toBe(777000);

    // 퐁당퐁당 엑셀: 기여도 0원 (시그 단가가 없으므로 777,000원이 누출되지 않음!)
    const pongdangExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
    const pongdangM4 = pongdangExcel.members.find((m) => m.id === "m4");
    expect(pongdangM4?.account).toBe(777000);
    expect(pongdangM4?.contribution).toBe(0);
  });

  // 4. 투네이션(Toonation) 777데이 후원 (target: 'toon')
  it("시나리오 4: 투네이션으로 들어온 777데이 시그 후원도 투네 원금과 퐁당퐁당 시그 기여도가 완벽히 분리된다", () => {
    const toonationEvent = sanitizeDonationEventFromIngestBody({
      id: "toonation:din:777_toon_04",
      externalId: "777_toon_04",
      donorName: "투네러버",
      amount: 777000,
      playerName: "영실",
      provider: "toonation",
      target: "toon",
      sigPrice: 100000,
      isSigCredit: true,
      matchedSigName: "10만시그",
      at: "2026-11-20 18:30:00",
    });

    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [toonationEvent!]);

    const pongdangExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
    const pongdangM1 = pongdangExcel.members.find((m) => m.id === "m1");
    expect(pongdangM1?.toon).toBe(777000);
    expect(pongdangM1?.contribution).toBe(100000);
  });

  // 5. Toona Polling (Pull) 모드로 777데이 데이터 수신 시 검증
  it("시나리오 5: Polling(Pull) API 응답을 통해 수신된 777데이 시그 데이터도 퐁당퐁당 엑셀표에 정상 반영된다", () => {
    const pollingRow: ToonaHubDonationApiRow = {
      id: "toona_poll_777_05",
      nickname: "폴링러버",
      amount: 777000,
      playerName: "얼음",
      channel: "bank",
      source: "sms",
      sigPrice: 50000,
      isSigCredit: true,
      sigName: "춤시그",
      createdAt: "2026-11-20 18:40:00",
    };

    const event = toonaHubDonationToEvent(pollingRow, 0);
    expect(event).not.toBeNull();
    expect(event?.sigPrice).toBe(50000);
    expect(event?.isSigCredit).toBe(true);

    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [event!]);

    const pongdangExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
    const pongdangM2 = pongdangExcel.members.find((m) => m.id === "m2");
    expect(pongdangM2?.account).toBe(777000);
    expect(pongdangM2?.contribution).toBe(50000);
  });

  // 6. 관리자 제외 (donationExcluded: true) 시 퐁당퐁당 기여도 즉시 차감
  it("시나리오 6: 관리자가 777데이 후원을 제외(donationExcluded)하면 퐁당퐁당 기여도에서도 안전하게 제외된다", () => {
    const sigEvent = sanitizeDonationEventFromIngestBody({
      id: "bank:sms:777_refund_06",
      externalId: "777_refund_06",
      donorName: "환불자",
      amount: 777000,
      playerName: "얼음",
      provider: "bank",
      sigPrice: 50000,
      isSigCredit: true,
      at: "2026-11-20 18:50:00",
    });

    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [sigEvent!]);

    // 정상 상태: 50,000원
    const beforeExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
    expect(beforeExcel.members.find((m) => m.id === "m2")?.contribution).toBe(50000);

    // 관리자가 제외 처리 (donationExcluded: true)
    const excludedState: AppState = {
      ...foldResult.state,
      donors: (foldResult.state.donors || []).map((d) =>
        d.id === "bank:sms:777_refund_06" ? { ...d, donationExcluded: true } : d
      ),
    };

    const afterExcel = applyOverlayDonationDisplayTotals(excludedState, { day777Calc: true });
    expect(afterExcel.members.find((m) => m.id === "m2")?.account).toBe(0);
    expect(afterExcel.members.find((m) => m.id === "m2")?.contribution).toBe(0);
  });

  // 7. 정산/퐁당 리셋 (pongdangResetAt) 전후 기여도 분리 검증
  it("시나리오 7: pongdangResetAt 리셋 시 이전 777데이 시그 기여도는 0원으로 리셋되고 이후 후원만 누적된다", () => {
    const oldSigEvent = sanitizeDonationEventFromIngestBody({
      id: "bank:sms:777_old_07",
      externalId: "777_old_07",
      donorName: "구후원자",
      amount: 777000,
      playerName: "수린",
      provider: "bank",
      sigPrice: 50000,
      isSigCredit: true,
      at: "2026-11-20 18:00:00", // 1763629200000
    });

    const newSigEvent = sanitizeDonationEventFromIngestBody({
      id: "bank:sms:777_new_07",
      externalId: "777_new_07",
      donorName: "신후원자",
      amount: 777000,
      playerName: "수린",
      provider: "bank",
      sigPrice: 30000,
      isSigCredit: true,
      at: "2026-11-20 19:30:00", // 1763634600000
    });

    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [oldSigEvent!, newSigEvent!]);

    // 18:30 시점에 퐁당퐁당 리셋 실행
    const resetTimestamp = new Date("2026-11-20 18:30:00").getTime();
    const resetState: AppState = {
      ...foldResult.state,
      pongdangResetAt: resetTimestamp,
    };

    const pongdangExcel = applyOverlayDonationDisplayTotals(resetState, { day777Calc: true });
    const pongdangM3 = pongdangExcel.members.find((m) => m.id === "m3");

    // 리셋 이전 50,000원은 제외되고, 리셋 이후 30,000원만 반영!
    expect(pongdangM3?.contribution).toBe(30000);
  });

  // 8. 퐁당퐁당 수동 모드(pongdangManualMode)와 Toona 자동 기여도 결합 검증
  it("시나리오 8: 퐁당퐁당 수동 조정값과 Toona 자동 수신 시그 단가가 안전하게 합산된다", () => {
    const sigEvent = sanitizeDonationEventFromIngestBody({
      id: "bank:sms:777_manual_08",
      externalId: "777_manual_08",
      donorName: "혼합러버",
      amount: 777000,
      playerName: "얼음",
      provider: "bank",
      sigPrice: 50000,
      isSigCredit: true,
      at: "2026-11-20 19:00:00",
    });

    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [sigEvent!]);

    // 관리자가 얼음(m2)에게 수동 보정 +20,000원 부여
    const manualState: AppState = {
      ...foldResult.state,
      pongdangManualMode: true,
      pongdangManualContributions: {
        m2: 20000,
      },
    };

    const pongdangExcel = applyOverlayDonationDisplayTotals(manualState, {
      day777Calc: true,
      pongdangManualMode: true,
    });
    const pongdangM2 = pongdangExcel.members.find((m) => m.id === "m2");

    // 자동 시그 단가 50,000원 + 수동 보정 20,000원 = 70,000원
    expect(pongdangM2?.contribution).toBe(70000);
  });
});
