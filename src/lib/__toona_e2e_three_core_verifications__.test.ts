import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { AppState, Donor } from "@/types";
import { defaultState } from "@/lib/state";
import { sanitizeDonationEventFromIngestBody } from "@/lib/donation/din-ingest";
import { foldIngestEventsIntoState } from "@/lib/din-ingest-batch-fold";
import { resetDinIngestBatchQueueForTests } from "@/lib/din-ingest-pending";
import { applyOverlayDonationDisplayTotals } from "@/lib/overlay-donation-aggregate";
import { mapToMember } from "@/lib/donation/mapper";
import type { DonorAlias } from "@/lib/donation/types";

describe("Toona ↔ YouTube 3대 핵심 연동 전수 검증 (누락방지 / 명칭·메시지 / 777데이 퐁당표)", () => {
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

  const aliases: DonorAlias[] = [
    { id: "a1", alias: "얼미", memberId: "m2" },
    { id: "a2", alias: "영시리", memberId: "m1" },
    { id: "a3", alias: "쑤린", memberId: "m3" },
  ];

  // =========================================================================
  // 1. 후원 누락되지 않고 오는지 (Deduplication, Queue, Drop 0건, Idempotency)
  // =========================================================================
  describe("1. 후원 누락 검증 (누락 0건 & 중복 안전성)", () => {
    it("1-1. 동일 후원자가 연속으로 후원해도 고유 ID/타임스탬프를 통해 1건도 누락되지 않고 전수 적재된다", () => {
      const baseState = createBaseState();
      // 동일 후원자 '열혈팬'이 1초 간격으로 연속 3건 50,000원씩 후원
      const events = [
        sanitizeDonationEventFromIngestBody({
          id: "bank:sms:tx_1001",
          externalId: "tx_1001",
          donorName: "열혈팬",
          amount: 50000,
          playerName: "영실",
          provider: "bank",
          message: "연속 후원 1",
          at: "2026-11-20 18:00:01",
        })!,
        sanitizeDonationEventFromIngestBody({
          id: "bank:sms:tx_1002",
          externalId: "tx_1002",
          donorName: "열혈팬",
          amount: 50000,
          playerName: "영실",
          provider: "bank",
          message: "연속 후원 2",
          at: "2026-11-20 18:00:02",
        })!,
        sanitizeDonationEventFromIngestBody({
          id: "bank:sms:tx_1003",
          externalId: "tx_1003",
          donorName: "열혈팬",
          amount: 50000,
          playerName: "영실",
          provider: "bank",
          message: "연속 후원 3",
          at: "2026-11-20 18:00:03",
        })!,
      ];

      const foldResult = foldIngestEventsIntoState(baseState, events, aliases);

      expect(foldResult.applied.length).toBe(3);
      expect(foldResult.duplicates).toBe(0);
      expect(foldResult.state.donors?.length).toBe(3);

      const m1 = foldResult.state.members.find((m) => m.id === "m1");
      expect(m1?.account).toBe(150000); // 3건 모두 온전히 합산 누락 없음!
    });

    it("1-2. 동일 트랜잭션의 중복 재전송(재시도)은 정확히 1건으로만 반영되어 이중 계상이 방지된다", () => {
      const baseState = createBaseState();
      const event1 = sanitizeDonationEventFromIngestBody({
        id: "bank:sms:tx_idemp_01",
        externalId: "tx_idemp_01",
        donorName: "팬A",
        amount: 30000,
        playerName: "수린",
        provider: "bank",
        at: "2026-11-20 18:05:00",
      })!;
      // 네트워크 재시도로 동일 id 전송
      const eventDuplicate = sanitizeDonationEventFromIngestBody({
        id: "bank:sms:tx_idemp_01",
        externalId: "tx_idemp_01",
        donorName: "팬A",
        amount: 30000,
        playerName: "수린",
        provider: "bank",
        at: "2026-11-20 18:05:00",
      })!;

      const foldResult = foldIngestEventsIntoState(baseState, [event1, eventDuplicate], aliases);

      expect(foldResult.applied.length).toBe(1);
      expect(foldResult.duplicates).toBe(1);
      expect(foldResult.state.donors?.length).toBe(1);
      const m3 = foldResult.state.members.find((m) => m.id === "m3");
      expect(m3?.account).toBe(30000);
    });

    it("1-3. 유효하지 않은 수동 지정 또는 비정상 대상 후원도 폐기되지 않고 unmatched 대기열로 안전 보존된다", () => {
      const baseState = createBaseState();
      const unmatchedEvent = sanitizeDonationEventFromIngestBody({
        id: "bank:sms:tx_unmatched_01",
        externalId: "tx_unmatched_01",
        donorName: "미지정후원자",
        amount: 70000,
        manualAssignMemberId: "non_existent_member_id", // 존재하지 않는 멤버로 수동 할당 지정
        provider: "bank",
        at: "2026-11-20 18:10:00",
      })!;

      const foldResult = foldIngestEventsIntoState(baseState, [unmatchedEvent], aliases);

      expect(foldResult.applied.length).toBe(0);
      expect(foldResult.unmatched.length).toBe(1);
      expect(foldResult.unmatched[0].donorName).toBe("미지정후원자");
      expect(foldResult.unmatched[0].amount).toBe(70000);
      // 버려지지 않고 수동 매칭 대기열로 안전 보존됨 확인
    });
  });

  // =========================================================================
  // 2. 후원자 명, 멤버명, 메시지 명확성 검증
  // =========================================================================
  describe("2. 후원자명 · 멤버명 · 메시지 파싱 및 매핑 정확성 검증", () => {
    it("2-1. 후원자명: 투네 애칭, 한글 자음(ㅜ, ㅠㅠ), 특수기호(+, &, @, #)가 변형 없이 온전히 들어온다", () => {
      const baseState = createBaseState();
      const events = [
        sanitizeDonationEventFromIngestBody({
          id: "toon:01",
          externalId: "ext_01",
          donorName: "곤", // 투네 해시가 애칭 '곤'으로 정제되어 들어온 건
          amount: 10000,
          playerName: "영실",
          provider: "toonation",
          message: "투네 애칭 테스트",
          at: "2026-11-20 18:15:00",
        })!,
        sanitizeDonationEventFromIngestBody({
          id: "bank:02",
          externalId: "ext_02",
          donorName: "ㅜㅜ", // 자음 닉네임
          amount: 20000,
          playerName: "얼음",
          provider: "bank",
          message: "자음 닉네임",
          at: "2026-11-20 18:15:01",
        })!,
        sanitizeDonationEventFromIngestBody({
          id: "bank:03",
          externalId: "ext_03",
          donorName: "길동+철수@vip#1", // 복합 특수기호 닉네임
          amount: 30000,
          playerName: "수린",
          provider: "bank",
          message: "특수기호 닉네임",
          at: "2026-11-20 18:15:02",
        })!,
      ];

      const foldResult = foldIngestEventsIntoState(baseState, events, aliases);

      expect(foldResult.applied.length).toBe(3);
      const donors = foldResult.state.donors || [];
      const dGon = donors.find((d) => d.donorName === "곤");
      const dConsonant = donors.find((d) => d.donorName === "ㅜㅜ");
      const dSpecial = donors.find((d) => d.donorName === "길동+철수@vip#1");

      expect(dGon?.name).toBe("곤");
      expect(dGon?.donorName).toBe("곤");
      expect(dConsonant?.name).toBe("ㅜㅜ");
      expect(dSpecial?.name).toBe("길동+철수@vip#1");
    });

    it("2-2. 멤버명: 별칭(얼미, 영시리)을 통한 매핑 및 원본 메시지가 100% 보존된다", () => {
      const baseState = createBaseState();
      const complexMsg = "🔥 얼미야 오늘 댄스 레전드 찍자!! ❤️ [리액션 1열 대기] ㅋㅋㅋ https://link.com";
      const event = sanitizeDonationEventFromIngestBody({
        id: "bank:alias_01",
        externalId: "alias_01",
        donorName: "슈퍼팬",
        amount: 80000,
        playerName: "얼미", // 별칭 사용 (얼음의 별칭)
        provider: "bank",
        message: complexMsg,
        at: "2026-11-20 18:20:00",
      })!;

      const foldResult = foldIngestEventsIntoState(baseState, [event], aliases);

      expect(foldResult.applied.length).toBe(1);
      const donor = foldResult.state.donors?.[0];
      expect(donor?.memberId).toBe("m2"); // 얼음(m2)으로 정확 매핑!
      expect(donor?.message).toBe(complexMsg); // 장문, 이모지, 특수문자, 영문 메시지 100% 온전 보존!
    });
  });

  // =========================================================================
  // 3. 777데이 옵션 반영시 퐁당퐁당 엑셀표 반영 여부 검증
  // =========================================================================
  describe("3. 777데이 퐁당퐁당 엑셀표 vs 메인 엑셀표 분리 집계 검증", () => {
    it("3-1. 777,000원 계좌 후원 + 50,000원 시그 당첨 시: 메인은 777,000원 기여도, 퐁당퐁당은 50,000원 기여도로 완벽 분리 반영된다", () => {
      const baseState = createBaseState();
      const event777 = sanitizeDonationEventFromIngestBody({
        id: "bank:777_win_50k",
        externalId: "777_win_50k",
        donorName: "럭키세븐",
        amount: 777000,
        playerName: "초화",
        provider: "bank",
        sigPrice: 50000,
        isSigCredit: true,
        matchedSigName: "샤르르 시그",
        message: "777 룰렛 5만 시그 당첨 축하!",
        at: "2026-11-20 18:25:00",
      })!;

      const foldResult = foldIngestEventsIntoState(baseState, [event777], aliases);
      expect(foldResult.applied.length).toBe(1);

      // ① 메인 엑셀표 (day777Calc: false)
      const mainExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: false });
      const mainM4 = mainExcel.members.find((m) => m.id === "m4");
      expect(mainM4?.account).toBe(777000); // 실제 입금액
      expect(mainM4?.contribution).toBe(777000); // 메인 기여도 777,000원

      // ② 퐁당퐁당 엑셀표 (day777Calc: true)
      const pongdangExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
      const pongdangM4 = pongdangExcel.members.find((m) => m.id === "m4");
      expect(pongdangM4?.account).toBe(777000); // 실제 입금 원금은 777,000원 보존!
      expect(pongdangM4?.contribution).toBe(50000); // 퐁당퐁당 기여도는 당첨된 시그 단가 50,000원만 반영!
    });

    it("3-2. 777,000원 계좌 후원 + 꽝(시그 미당첨) 시: 퐁당퐁당 기여도는 0원으로 처리되어 뻥튀기가 원천 차단된다", () => {
      const baseState = createBaseState();
      const event777Kwang = sanitizeDonationEventFromIngestBody({
        id: "bank:777_kwang",
        externalId: "777_kwang",
        donorName: "아쉬운팬",
        amount: 777000,
        playerName: "영실",
        provider: "bank",
        // sigPrice 없음 (꽝)
        message: "아쉽게 꽝 ㅠㅠ",
        at: "2026-11-20 18:30:00",
      })!;

      const foldResult = foldIngestEventsIntoState(baseState, [event777Kwang], aliases);

      const pongdangExcel = applyOverlayDonationDisplayTotals(foldResult.state, { day777Calc: true });
      const pongdangM1 = pongdangExcel.members.find((m) => m.id === "m1");
      expect(pongdangM1?.account).toBe(777000);
      expect(pongdangM1?.contribution).toBe(0); // 꽝이므로 퐁당퐁당 기여도 0원!
    });

    it("3-3. 퐁당퐁당 리셋(pongdangResetAt) 시: 원장 및 메인 엑셀은 보존되면서 퐁당퐁당 기여도만 0원에서 새로 누적된다", () => {
      const baseState = createBaseState();
      const oldEvent = sanitizeDonationEventFromIngestBody({
        id: "bank:777_before_reset",
        externalId: "777_before_reset",
        donorName: "1회차팬",
        amount: 777000,
        playerName: "얼음",
        provider: "bank",
        sigPrice: 50000,
        isSigCredit: true,
        at: "2026-11-20 18:00:00",
      })!;
      const newEvent = sanitizeDonationEventFromIngestBody({
        id: "bank:777_after_reset",
        externalId: "777_after_reset",
        donorName: "2회차팬",
        amount: 777000,
        playerName: "얼음",
        provider: "bank",
        sigPrice: 30000,
        isSigCredit: true,
        at: "2026-11-20 19:00:00",
      })!;

      const foldResult = foldIngestEventsIntoState(baseState, [oldEvent, newEvent], aliases);

      // 18:30 시점에 퐁당퐁당 판 리셋 실행
      const resetState: AppState = {
        ...foldResult.state,
        pongdangResetAt: new Date("2026-11-20 18:30:00").getTime(),
      };

      const pongdangExcel = applyOverlayDonationDisplayTotals(resetState, { day777Calc: true });
      const pongdangM2 = pongdangExcel.members.find((m) => m.id === "m2");

      // 퐁당퐁당 기여도: 리셋 이전 50,000원은 제외되고 리셋 이후 30,000원만 표출!
      expect(pongdangM2?.contribution).toBe(30000);
      // 메인 계좌 원장은 777,000 x 2 = 1,554,000원 온전히 보존
      expect(pongdangM2?.account).toBe(1554000);
    });
  });
});
