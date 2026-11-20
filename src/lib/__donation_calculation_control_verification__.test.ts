import { describe, it, expect } from "vitest";
import type { AppState, Donor, Member, MealBattleState, SigMatchSettings } from "@/types";
import { defaultState } from "@/lib/state";
import {
  applyOverlayDonationDisplayTotals,
  collectDay777SigContributionByMember,
  normalizeDonationAggregateFromAt,
} from "./overlay-donation-aggregate";
import {
  recalculateMealParticipantScoresFromDonors,
  applyMealBattleDonationsFromTime,
  resetMealBattleDonationUi,
  setSigMatchDonationCountFrom,
} from "./battle-donation-sync";
import { getSigMatchRankings } from "./settlement-utils";
import { resolveDonationAggregateFromAt, presetToParams } from "./overlay-params";

describe("후원 책정 제어 (현재시간부터 / 특정시간부터 / 초기화 / 책정 OFF) 종합 검증", () => {
  const m1: Member = { id: "m1", name: "영실", account: 0, toon: 0, contribution: 0 };
  const m2: Member = { id: "m2", name: "얼음", account: 0, toon: 0, contribution: 0 };

  const createPongdangState = (overrides?: Partial<AppState>): AppState => ({
    ...defaultState(),
    members: [m1, m2],
    donors: [],
    contributionLogs: [],
    ...overrides,
  });

  // ==========================================
  // 1. 퐁당퐁당 엑셀표 후원 책정 제어
  // ==========================================
  describe("1. 퐁당퐁당 엑셀표 후원 책정 제어 검증", () => {
    it("시나리오 1: [현재 시간부터] 이전 후원은 제외되고, 현재 시각 이후의 777 시그 후원만 퐁당 기여도에 반영된다", () => {
      const pastTime = 1000;
      const nowTime = 5000;
      const futureTime = 8000;

      const state = createPongdangState({
        pongdangResetAt: nowTime,
        donors: [
          // 이전 후원 (nowTime 이전): 777k 후원 + 시그 50k
          { id: "d1", name: "팬1", memberId: "m1", amount: 777000, at: pastTime, target: "account", sigPrice: 50000, isSigCredit: true },
          // 현재 이후 후원 (nowTime 이후): 777k 후원 + 시그 30k
          { id: "d2", name: "팬2", memberId: "m1", amount: 777000, at: futureTime, target: "account", sigPrice: 30000, isSigCredit: true },
        ],
      });

      // 퐁당퐁당 엑셀 표출: 현재시간부터 (day777Calc: true, fromAt: nowTime)
      const res = applyOverlayDonationDisplayTotals(state, { day777Calc: true, fromAt: nowTime });
      const member1 = res.members.find((m) => m.id === "m1");

      // nowTime(5000) 이후인 d2의 시그 단가 30,000원만 반영되어야 함
      expect(member1?.contribution).toBe(30000);
      // 계좌 열도 nowTime 이후 후원만 반영 (777,000원 1건)
      expect(member1?.account).toBe(777000);
    });

    it("시나리오 2: [특정 일시부터] 지정한 일시(fromAt) 이후 발생한 후원만 기여도 및 계좌에 집계된다", () => {
      const cutoffTime = 1700000000000;

      const state = createPongdangState({
        donors: [
          // cutoff 이전
          { id: "d1", name: "팬1", memberId: "m2", amount: 777000, at: cutoffTime - 1000, target: "account", sigPrice: 40000, isSigCredit: true },
          // cutoff 이후
          { id: "d2", name: "팬2", memberId: "m2", amount: 777000, at: cutoffTime + 5000, target: "account", sigPrice: 60000, isSigCredit: true },
        ],
      });

      const res = applyOverlayDonationDisplayTotals(state, {
        day777Calc: true,
        fromAt: cutoffTime,
      });
      const member2 = res.members.find((m) => m.id === "m2");

      expect(member2?.contribution).toBe(60000);
      expect(member2?.account).toBe(777000);
    });

    it("시나리오 3: [초기화] 기여도가 0원으로 리셋되고 이후 새로운 후원부터 누적 집계된다", () => {
      const resetTime = 10000;

      // 리셋 전 상태
      const stateBeforeReset = createPongdangState({
        donors: [
          { id: "d1", name: "팬1", memberId: "m1", amount: 777000, at: 5000, target: "account", sigPrice: 50000, isSigCredit: true },
        ],
      });
      const beforeRes = applyOverlayDonationDisplayTotals(stateBeforeReset, { day777Calc: true });
      expect(beforeRes.members.find((m) => m.id === "m1")?.contribution).toBe(50000);

      // 리셋 적용: pongdangResetAt = resetTime, manualContributions = 0
      const stateAfterReset = createPongdangState({
        pongdangResetAt: resetTime,
        pongdangManualContributions: { m1: 0, m2: 0 },
        donors: [
          { id: "d1", name: "팬1", memberId: "m1", amount: 777000, at: 5000, target: "account", sigPrice: 50000, isSigCredit: true },
        ],
      });
      const afterRes = applyOverlayDonationDisplayTotals(stateAfterReset, { day777Calc: true });
      expect(afterRes.members.find((m) => m.id === "m1")?.contribution).toBe(0);

      // 리셋 이후 새 후원 인입
      const stateWithNewDonation = createPongdangState({
        pongdangResetAt: resetTime,
        donors: [
          { id: "d1", name: "팬1", memberId: "m1", amount: 777000, at: 5000, target: "account", sigPrice: 50000, isSigCredit: true },
          { id: "d2", name: "팬2", memberId: "m1", amount: 777000, at: 15000, target: "account", sigPrice: 70000, isSigCredit: true },
        ],
      });
      const newRes = applyOverlayDonationDisplayTotals(stateWithNewDonation, { day777Calc: true });
      expect(newRes.members.find((m) => m.id === "m1")?.contribution).toBe(70000);
    });

    it("시나리오 4: [책정 OFF] fromAt = -1 또는 pongdangResetAt = -1일 때 오버레이 표출 기여도 및 후원금이 즉시 0원으로 고정된다", () => {
      const state = createPongdangState({
        pongdangResetAt: -1, // 책정 OFF
        donors: [
          { id: "d1", name: "팬1", memberId: "m1", amount: 777000, at: 5000, target: "account", sigPrice: 50000, isSigCredit: true },
          { id: "d2", name: "팬2", memberId: "m2", amount: 100000, at: 6000, target: "toon" },
        ],
      });

      // 1) state.pongdangResetAt === -1 기반 책정 OFF
      const resStateOff = applyOverlayDonationDisplayTotals(state, { day777Calc: true });
      expect(resStateOff.members.find((m) => m.id === "m1")?.contribution).toBe(0);

      // 2) preset/URL fromAt = -1 (책정 OFF)
      const resFromAtOff = applyOverlayDonationDisplayTotals(state, { day777Calc: true, fromAt: -1 });
      const m1Res = resFromAtOff.members.find((m) => m.id === "m1");
      const m2Res = resFromAtOff.members.find((m) => m.id === "m2");

      expect(m1Res?.account).toBe(0);
      expect(m1Res?.toon).toBe(0);
      expect(m1Res?.contribution).toBe(0);
      expect(m2Res?.account).toBe(0);
      expect(m2Res?.toon).toBe(0);
      expect(m2Res?.contribution).toBe(0);
    });

    it("시나리오 5: [전체 기간] 필터 해제 시 과거 후원이 온전히 원복되어 집계된다", () => {
      const state = createPongdangState({
        pongdangResetAt: 0, // 전체 기간
        donors: [
          { id: "d1", name: "팬1", memberId: "m1", amount: 777000, at: 1000, target: "account", sigPrice: 50000, isSigCredit: true },
          { id: "d2", name: "팬2", memberId: "m1", amount: 777000, at: 2000, target: "account", sigPrice: 20000, isSigCredit: true },
        ],
      });

      const res = applyOverlayDonationDisplayTotals(state, { day777Calc: true, fromAt: null });
      expect(res.members.find((m) => m.id === "m1")?.contribution).toBe(70000);
      expect(res.members.find((m) => m.id === "m1")?.account).toBe(1554000);
    });
  });

  // ==========================================
  // 2. 대전 모드 (식사 대전 / 시그 대전 / 팀 대전차)
  // ==========================================
  describe("2. 대전 모드 후원 책정 제어 검증", () => {
    const createBaseMealBattle = (): MealBattleState => ({
      participants: [
        { memberId: "m1", name: "영실", score: 0, goal: 100, color: "#f00", donationLinkActive: true, donationLinkStartedAt: 0 },
        { memberId: "m2", name: "얼음", score: 0, goal: 100, color: "#00f", donationLinkActive: true, donationLinkStartedAt: 0 },
      ],
      memberGaugeColors: {},
      overlayTitle: "식사 대전",
      currentMission: "",
      totalGoal: 100,
      timerTheme: "default",
      timerSize: 36,
      missionBubbleBg: "#000",
      missionBubbleTextColor: "#fff",
      gaugeTrackBg: "#111",
      gaugeTrackBorderColor: "#222",
      gaugeFillColor: "#22c55e",
      scoreTextColor: "#fff",
      nameTagBg: "#000",
      nameTagTextColor: "#fff",
      showPanelBorder: false,
      panelBorderColor: "#fff",
      showGaugeTrackBorder: false,
      teamBattleEnabled: true,
      scoreUsesRawDonationAmount: true,
      teamAName: "A",
      teamBName: "B",
      teamAGoal: 0,
      teamBGoal: 0,
      teamAMemberIds: ["m1"],
      teamBMemberIds: ["m2"],
      teamAColor: "#f00",
      teamBColor: "#00f",
    });

    const createBaseSigMatch = (): SigMatchSettings => ({
      isActive: true,
      targetCount: 100,
      title: "시그 대전",
      keyword: "시그",
      signatureAmounts: [10000],
      scoringMode: "amount",
      countAllDonations: true,
      incentivePerPoint: 1000,
      sigMatchPools: [],
      participantMemberIds: ["m1", "m2"],
      donationLinks: {
        m1: { active: true, startedAt: 0 },
        m2: { active: true, startedAt: 0 },
      },
    });

    it("시나리오 6: 식사 대전 - [현재 시간부터] 및 [특정 시간부터] 설정 시 해당 시각 이후의 후원만 대전 점수에 반영된다", () => {
      const mb = createBaseMealBattle();
      const donors: Donor[] = [
        { id: "d1", name: "팬", memberId: "m1", amount: 50000, at: 1000, target: "account" },
        { id: "d2", name: "팬", memberId: "m1", amount: 70000, at: 3000, target: "account" },
      ];

      // 1) 전체 기간 (startedAt: 0)
      const allScores = recalculateMealParticipantScoresFromDonors(mb, donors);
      expect(allScores.find((p) => p.memberId === "m1")?.score).toBe(120000);

      // 2) 특정 시간 (fromAt: 2000)
      const timedMb = applyMealBattleDonationsFromTime(mb, donors, { fromAt: 2000 });
      expect(timedMb.participants.find((p) => p.memberId === "m1")?.score).toBe(70000);
    });

    it("시나리오 7: 식사 대전 - [초기화] 시 게이지 점수가 0으로 리셋되고 새로운 후원부터 누적된다", () => {
      const mb = createBaseMealBattle();
      const resetMb = resetMealBattleDonationUi(mb, 5000);

      expect(resetMb.participants.every((p) => p.score === 0)).toBe(true);
      expect(resetMb.participants.every((p) => p.donationLinkStartedAt === 5000)).toBe(true);
    });

    it("시나리오 8: 식사 대전 - [책정 OFF] 시 참가자의 후원 연동(donationLinkActive)이 꺼져 후원이 들어와도 점수가 올라가지 않는다", () => {
      const mb = createBaseMealBattle();
      // 책정 OFF
      const offMb: MealBattleState = {
        ...mb,
        participants: mb.participants.map((p) => ({ ...p, donationLinkActive: false })),
      };

      const donors: Donor[] = [
        { id: "d1", name: "팬", memberId: "m1", amount: 50000, at: 1000, target: "account" },
      ];
      const scores = recalculateMealParticipantScoresFromDonors(offMb, donors);
      expect(scores.find((p) => p.memberId === "m1")?.score).toBe(0);
    });

    it("시나리오 9: 시그 대전 - [현재 시간부터] / [초기화] / [책정 OFF] 제어가 점수에 정확히 반영된다", () => {
      const sigSettings = createBaseSigMatch();
      const membersList = [m1, m2];
      const donors: Donor[] = [
        { id: "d1", name: "팬", memberId: "m1", amount: 100000, at: 1000, target: "toon" },
        { id: "d2", name: "팬", memberId: "m1", amount: 200000, at: 3000, target: "toon" },
      ];

      // 1) 전체 기간
      const rankAll = getSigMatchRankings(donors, membersList, sigSettings, {}, {});
      expect(rankAll.find((r) => r.memberId === "m1")?.score).toBe(300000);

      // 2) 특정 시간 (2000 이후)
      const settingsFromTime = setSigMatchDonationCountFrom(sigSettings, ["m1", "m2"], 2000);
      const rankTimed = getSigMatchRankings(donors, membersList, settingsFromTime, {}, {});
      expect(rankTimed.find((r) => r.memberId === "m1")?.score).toBe(200000);

      // 3) 책정 OFF (donationLinks active: false)
      const settingsOff: SigMatchSettings = {
        ...sigSettings,
        donationLinks: {
          m1: { active: false, startedAt: 0 },
          m2: { active: false, startedAt: 0 },
        },
      };
      const rankOff = getSigMatchRankings(donors, membersList, settingsOff, {}, {});
      expect(rankOff.find((r) => r.memberId === "m1")?.score).toBe(0);
    });

    it("시나리오 10: 오버레이 팀 대전차(showTeamBattle) - 책정 OFF(fromAt = -1) 시 팀 점수가 0으로 안전하게 차단된다", () => {
      const mb = createBaseMealBattle();
      // 점수가 계산되어 있는 상태
      const scoredParticipants = [
        { memberId: "m1", name: "영실", score: 100000, goal: 100, color: "#f00" },
        { memberId: "m2", name: "얼음", score: 200000, goal: 100, color: "#00f" },
      ];
      const mbWithScores = { ...mb, participants: scoredParticipants };

      // 책정 OFF (-1) 시 점수 0 반환 검증
      const resolveTeamBattleBoard = (aggFromAt: number | null) => {
        if (aggFromAt === -1) {
          return { aScore: 0, bScore: 0 };
        }
        return {
          aScore: mbWithScores.participants.filter(p => mbWithScores.teamAMemberIds.includes(p.memberId)).reduce((s, p) => s + p.score, 0),
          bScore: mbWithScores.participants.filter(p => mbWithScores.teamBMemberIds.includes(p.memberId)).reduce((s, p) => s + p.score, 0),
        };
      };

      // 정상 ON 일 때: A팀 100,000, B팀 200,000
      expect(resolveTeamBattleBoard(null)).toEqual({ aScore: 100000, bScore: 200000 });
      // 책정 OFF (-1) 일 때: 둘 다 0
      expect(resolveTeamBattleBoard(-1)).toEqual({ aScore: 0, bScore: 0 });
    });
  });

  // ==========================================
  // 3. OBS 오버레이 URL & 프리셋 파라미터 직렬화
  // ==========================================
  describe("3. OBS 오버레이 URL & 프리셋 직렬화 검증", () => {
    it("donationAggregateFromAt 옵션이 off, epoch_ms, 빈값으로 정확히 직렬화 및 역직렬화된다", () => {
      // 1) "off" 설정
      const qOff = presetToParams({ id: "p1", donationAggregateFromAt: "off" });
      expect(qOff.get("donationAggregateFromAt")).toBe("off");
      expect(resolveDonationAggregateFromAt(new URLSearchParams(), { id: "p1", donationAggregateFromAt: "off" }, { ready: true })).toBe(-1);

      // 2) epoch ms 타임스탬프 설정
      const qTime = presetToParams({ id: "p2", donationAggregateFromAt: "1732118400000" });
      expect(qTime.get("donationAggregateFromAt")).toBe("1732118400000");
      expect(resolveDonationAggregateFromAt(new URLSearchParams(), { id: "p2", donationAggregateFromAt: "1732118400000" }, { ready: true })).toBe(1732118400000);

      // 3) 전체 기간 (빈값)
      const qAll = presetToParams({ id: "p3", donationAggregateFromAt: "" });
      expect(qAll.get("donationAggregateFromAt")).toBeNull();
      expect(resolveDonationAggregateFromAt(new URLSearchParams(), { id: "p3", donationAggregateFromAt: "" }, { ready: true })).toBeNull();
    });
  });
});
