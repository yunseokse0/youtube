import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { AppState, Donor, Member } from "@/types";
import { defaultState } from "@/lib/state";
import { toonaHubDonationToEvent, type ToonaHubDonationApiRow } from "@/lib/toona-hub-donation-map";
import { sanitizeDonationEventFromIngestBody } from "@/lib/donation/din-ingest";
import { foldIngestEventsIntoState } from "@/lib/din-ingest-batch-fold";
import { offerPendingIngest, resetDinIngestBatchQueueForTests, getDinIngestStore } from "@/lib/din-ingest-pending";
import { applyOverlayDonationDisplayTotals } from "@/lib/overlay-donation-aggregate";

describe("Toona 후원 수신 정합성 (누락 & 뻥튀기 방지) 검증", () => {
  beforeEach(() => {
    resetDinIngestBatchQueueForTests();
  });

  const createBaseState = (): AppState => ({
    ...defaultState(),
    members: [
      { id: "m1", name: "영실", account: 0, toon: 0, contribution: 0, goal: 500000 },
      { id: "m2", name: "얼음", account: 0, toon: 0, contribution: 0, goal: 500000 },
    ],
    donors: [],
  });

  // 1. 단일 후원 정상 수신 및 정산표 반영 (누락 방지)
  it("toona 후원이 들어왔을 때 누락 없이 계좌/투네 및 기여도에 정확히 반영된다", () => {
    const rawRow: ToonaHubDonationApiRow = {
      id: "toona_row_001",
      nickname: "열혈팬",
      amount: 50000,
      playerName: "영실",
      channel: "toonation",
      message: "영실이 응원해",
      createdAt: "2026-11-10 16:00:00",
    };

    const event = toonaHubDonationToEvent(rawRow, 0);
    expect(event).not.toBeNull();
    expect(event?.amount).toBe(50000);
    expect(event?.target).toBe("toon");

    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [event!]);

    expect(foldResult.applied.length).toBe(1);
    expect(foldResult.duplicates).toBe(0);
    expect(foldResult.unmatched.length).toBe(0);

    const m1 = foldResult.state.members.find((m) => m.id === "m1");
    expect(m1?.toon).toBe(50000);
    expect(m1?.contribution).toBe(50000);
  });

  // 2. Webhook + Polling 2중 유입 시 중복 방지 (뻥튀기 원천 차단)
  it("동일 후원이 Webhook(Push)과 Polling(Pull)으로 2번 들어와도 1건만 반영되고 금액이 2배로 뻥튀기되지 않는다", () => {
    const externalId = "ext_dup_test_123";

    // 1) Webhook으로 먼저 들어옴
    const webhookEvent = sanitizeDonationEventFromIngestBody({
      id: `toonation:din:${externalId}`,
      externalId,
      donorName: "큰손",
      amount: 100000,
      playerName: "얼음",
      provider: "toonation",
      at: "2026-11-10 16:01:00",
    });

    // 2) 30초 뒤 Polling으로 동일 후원이 또 들어옴
    const pollEvent = toonaHubDonationToEvent(
      {
        id: externalId,
        nickname: "큰손",
        amount: 100000,
        playerName: "얼음",
        channel: "toonation",
        createdAt: "2026-11-10 16:01:00",
      },
      0
    );

    expect(webhookEvent).not.toBeNull();
    expect(pollEvent).not.toBeNull();

    // 큐 레벨 중복 차단 검증
    const enq1 = offerPendingIngest("hub_user", "finalent", webhookEvent!);
    expect(enq1.duplicateQueued).toBe(false);

    const enq2 = offerPendingIngest("hub_user", "finalent", pollEvent!);
    expect(enq2.duplicateQueued).toBe(true); // 큐에서 중복 감지되어 스킵!

    // 상태 병합 레벨 중복 차단 검증
    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [webhookEvent!, pollEvent!]);

    expect(foldResult.applied.length).toBe(1); // 1건만 성공
    expect(foldResult.duplicates).toBe(1); // 1건은 중복으로 안전하게 제외!

    const m2 = foldResult.state.members.find((m) => m.id === "m2");
    expect(m2?.toon).toBe(100000); // 200,000원이 아닌 100,000원 그대로 유지 (뻥튀기 없음)
  });

  // 3. 연타 후원 (동일 후원자 + 동일 금액 + 같은 시간) 정상 수신 (오탐 누락 방지)
  it("동일 후원자가 같은 금액을 연속으로 여러 번 쏜 연타 후원은 고유 ID가 다르므로 누락 없이 모두 반영된다", () => {
    const baseState = createBaseState();

    const event1 = sanitizeDonationEventFromIngestBody({
      id: "toonation:din:combo_1",
      externalId: "combo_1",
      donorName: "연타왕",
      amount: 10000,
      playerName: "영실",
      provider: "toonation",
      at: "2026-11-10 16:05:00",
    });

    const event2 = sanitizeDonationEventFromIngestBody({
      id: "toonation:din:combo_2",
      externalId: "combo_2",
      donorName: "연타왕",
      amount: 10000,
      playerName: "영실",
      provider: "toonation",
      at: "2026-11-10 16:05:01",
    });

    const event3 = sanitizeDonationEventFromIngestBody({
      id: "toonation:din:combo_3",
      externalId: "combo_3",
      donorName: "연타왕",
      amount: 10000,
      playerName: "영실",
      provider: "toonation",
      at: "2026-11-10 16:05:02",
    });

    const foldResult = foldIngestEventsIntoState(baseState, [event1!, event2!, event3!]);

    expect(foldResult.applied.length).toBe(3); // 3건 모두 정상 반영
    expect(foldResult.duplicates).toBe(0);

    const m1 = foldResult.state.members.find((m) => m.id === "m1");
    expect(m1?.toon).toBe(30000); // 10,000 * 3 = 30,000원 누락 없이 전액 합산
  });

  // 4. 멤버 미지정 후원 자동 배정 및 완전 미매칭 시 증발 방지
  it("멤버 이름이 없거나 불일치할 때도 방송 룰(1위 멤버 또는 자동 배정)에 따라 안전하게 반영되거나 unmatched로 보존된다", () => {
    const baseState = createBaseState();

    // 1) 멤버 이름이 불일치해도 후원이 누락/증발되지 않고 1위 멤버/대표로 자동 반영
    const fallbackEvent = sanitizeDonationEventFromIngestBody({
      id: "bank:din:fallback_01",
      externalId: "fallback_01",
      donorName: "팬A",
      amount: 50000,
      playerName: "존재하지않는멤버",
      provider: "bank",
      at: "2026-11-10 16:10:00",
    });

    const foldResult1 = foldIngestEventsIntoState(baseState, [fallbackEvent!]);
    expect(foldResult1.applied.length).toBe(1); // 후원이 절대 누락되지 않고 자동 배정되어 정산표에 저장!
    expect(foldResult1.applied[0]?.amount).toBe(50000);

    // 2) 등록된 멤버가 아예 없는 극단적 상황에서는 unmatched로 안전하게 수집 (증발 방지)
    const emptyMemberState: AppState = {
      ...baseState,
      members: [],
    };
    const foldResult2 = foldIngestEventsIntoState(emptyMemberState, [fallbackEvent!]);
    expect(foldResult2.applied.length).toBe(0);
    expect(foldResult2.unmatched.length).toBe(1); // 버려지지 않고 관리자 대기열로 보존!
    expect(foldResult2.unmatched[0]?.amount).toBe(50000);
  });

  // 5. Toona 시그 당첨 후원 (퐁당퐁당 기여도 분리 검증)
  it("toona에서 룰렛 당첨 시그 후원이 들어왔을 때 계좌 원금과 시그 기여도가 오염 없이 분리 계산된다", () => {
    const sigEvent = sanitizeDonationEventFromIngestBody({
      id: "bank:din:sig_777_01",
      externalId: "sig_777_01",
      donorName: "룰렛러버",
      amount: 777000,
      playerName: "얼음",
      provider: "bank",
      sigPrice: 50000,
      isSigCredit: true,
      at: "2026-11-10 16:15:00",
    });

    expect(sigEvent?.sigPrice).toBe(50000);
    expect(sigEvent?.isSigCredit).toBe(true);

    const baseState = createBaseState();
    const foldResult = foldIngestEventsIntoState(baseState, [sigEvent!]);

    // 메인 엑셀: 계좌 777,000원, 기여도 777,000원
    const mainExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: false });
    const mainM2 = mainExcel.members.find((m) => m.id === "m2");
    expect(mainM2?.account).toBe(777000);
    expect(mainM2?.contribution).toBe(777000);

    // 퐁당퐁당 엑셀: 계좌 777,000원, 기여도는 나온 시그 50,000원만!
    const pongdangExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
    const pongdangM2 = pongdangExcel.members.find((m) => m.id === "m2");
    expect(pongdangM2?.account).toBe(777000);
    expect(pongdangM2?.contribution).toBe(50000); // 뻥튀기나 누락 없이 정확한 시그 단가 반영!
  });
});
