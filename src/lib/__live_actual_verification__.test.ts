import { describe, it, expect } from "vitest";
import type { AppState, Donor, Member, MealBattleState, SigMatchSettings } from "@/types";
import { defaultState } from "@/lib/state";
import {
  applyOverlayDonationDisplayTotals,
  normalizeDonationAggregateFromAt,
  resolveOverlayContributionSource,
} from "@/lib/overlay-donation-aggregate";
import {
  recalculateMealParticipantScoresFromDonors,
  applyMealBattleDonationsFromTime,
  resetMealBattleDonationUi,
  setSigMatchDonationCountFrom,
} from "@/lib/battle-donation-sync";
import { getSigMatchRankings } from "@/lib/settlement-utils";
import { resolveDonationAggregateFromAt, presetToParams } from "@/lib/overlay-params";

describe("후원 책정 제어 (현재시간부터/특정시간부터/초기화/책정OFF) 실제 동작 전수 검증", () => {
  const m1: Member = { id: "m1", name: "영실", account: 0, toon: 0, contribution: 0 };
  const m2: Member = { id: "m2", name: "얼음", account: 0, toon: 0, contribution: 0 };

  const sampleDonors: Donor[] = [
    // 과거 후원 (10:00:00 = 1732150800000)
    {
      id: "d1",
      name: "열혈팬A",
      memberId: "m1",
      amount: 777000,
      at: 1732150800000,
      target: "account",
      sigPrice: 50000,
      isSigCredit: true,
      matchedSigName: "샤인시그",
    },
    // 현재 후원 (11:00:00 = 1732154400000)
    {
      id: "d2",
      name: "열혈팬B",
      memberId: "m1",
      amount: 777000,
      at: 1732154400000,
      target: "account",
      sigPrice: 30000,
      isSigCredit: true,
      matchedSigName: "댄스시그",
    },
    // 미래/최신 후원 (12:00:00 = 1732158000000)
    {
      id: "d3",
      name: "열혈팬C",
      memberId: "m2",
      amount: 777000,
      at: 1732158000000,
      target: "toon",
      sigPrice: 100000,
      isSigCredit: true,
      matchedSigName: "VIP시그",
    },
  ];

  const baseState: AppState = {
    ...defaultState(),
    members: [m1, m2],
    donors: sampleDonors,
    contributionLogs: [],
  };

  // ----------------------------------------------------
  // 1. 퐁당퐁당 엑셀표 검증
  // ----------------------------------------------------
  describe("1. 퐁당퐁당 엑셀표 실제 집계 및 표출", () => {
    it("1-1. [전체 기간]: 과거부터 현재까지 모든 777 시그 단가가 기여도에 전액 합산된다", () => {
      const res = applyOverlayDonationDisplayTotals(baseState, {
        day777Calc: true,
        fromAt: null,
      });

      const resM1 = res.members.find((m) => m.id === "m1");
      const resM2 = res.members.find((m) => m.id === "m2");

      console.log("\n[실제 검증 1-1] 퐁당퐁당 전체 기간");
      console.log(`- m1(영실) 계좌: ${resM1?.account.toLocaleString()}원 (예상 1,554,000원)`);
      console.log(`- m1(영실) 기여도: ${resM1?.contribution.toLocaleString()}원 (예상 80,000원: 50k+30k)`);
      console.log(`- m2(얼음) 투네: ${resM2?.toon.toLocaleString()}원 (예상 777,000원)`);
      console.log(`- m2(얼음) 기여도: ${resM2?.contribution.toLocaleString()}원 (예상 100,000원)`);

      expect(resM1?.account).toBe(1554000);
      expect(resM1?.contribution).toBe(80000);
      expect(resM2?.toon).toBe(777000);
      expect(resM2?.contribution).toBe(100000);
    });

    it("1-2. [현재 시간부터]: 11:00:00(현재) 이후 발생한 후원만 계좌 및 퐁당 기여도에 반영된다", () => {
      const currentTime = 1732154400000; // 11:00:00
      const res = applyOverlayDonationDisplayTotals(baseState, {
        day777Calc: true,
        fromAt: currentTime,
      });

      const resM1 = res.members.find((m) => m.id === "m1");
      console.log("\n[실제 검증 1-2] 퐁당퐁당 현재 시간부터 (11:00:00 이후)");
      console.log(`- m1(영실) 계좌: ${resM1?.account.toLocaleString()}원 (10시 후원 777,000원 제외 -> 777,000원)`);
      console.log(`- m1(영실) 기여도: ${resM1?.contribution.toLocaleString()}원 (10시 50k 제외 -> 30,000원만 반영)`);

      expect(resM1?.account).toBe(777000);
      expect(resM1?.contribution).toBe(30000);
    });

    it("1-3. [특정 시간부터]: 11:30:00 이후 후원만 선별 반영된다", () => {
      const specificTime = 1732156200000; // 11:30:00
      const res = applyOverlayDonationDisplayTotals(baseState, {
        day777Calc: true,
        fromAt: specificTime,
      });

      const resM1 = res.members.find((m) => m.id === "m1");
      const resM2 = res.members.find((m) => m.id === "m2");

      console.log("\n[실제 검증 1-3] 퐁당퐁당 특정 시간부터 (11:30:00 이후)");
      console.log(`- m1(영실): 기여도 ${resM1?.contribution}원 (11시 이전이므로 0원)`);
      console.log(`- m2(얼음): 기여도 ${resM2?.contribution}원 (12시 후원 100,000원 반영)`);

      expect(resM1?.contribution).toBe(0);
      expect(resM2?.contribution).toBe(100000);
    });

    it("1-4. [초기화]: 기여도가 0원으로 리셋되고 이후 새로운 후원부터 누적된다", () => {
      const resetTime = 1732155000000; // 11:16:40
      const resetState: AppState = {
        ...baseState,
        pongdangResetAt: resetTime,
        pongdangManualContributions: { m1: 0, m2: 0 },
      };

      const res = applyOverlayDonationDisplayTotals(resetState, {
        day777Calc: true,
        fromAt: resetTime,
      });

      const resM1 = res.members.find((m) => m.id === "m1");
      const resM2 = res.members.find((m) => m.id === "m2");

      console.log("\n[실제 검증 1-4] 퐁당퐁당 초기화 (11:16:40 기준)");
      console.log(`- m1(영실): 기여도 ${resM1?.contribution}원 (초기화 시점 이전이므로 0원)`);
      console.log(`- m2(얼음): 기여도 ${resM2?.contribution}원 (초기화 시점 이후 12시 후원 100,000원 누적)`);

      expect(resM1?.contribution).toBe(0);
      expect(resM2?.contribution).toBe(100000);
    });

    it("1-5. [책정 OFF]: fromAt = -1 또는 pongdangResetAt = -1 설정 시 오버레이 화면에 0원으로 완전 차단된다", () => {
      const offState: AppState = {
        ...baseState,
        pongdangResetAt: -1,
      };

      const resStateOff = applyOverlayDonationDisplayTotals(offState, { day777Calc: true });
      const resParamOff = applyOverlayDonationDisplayTotals(baseState, { day777Calc: true, fromAt: -1 });

      console.log("\n[실제 검증 1-5] 퐁당퐁당 책정 OFF");
      console.log(`- state 책정 OFF m1 기여도: ${resStateOff.members[0].contribution}원`);
      console.log(`- param 책정 OFF m1 계좌: ${resParamOff.members[0].account}원, 기여도: ${resParamOff.members[0].contribution}원`);

      expect(resStateOff.members[0].contribution).toBe(0);
      expect(resParamOff.members[0].account).toBe(0);
      expect(resParamOff.members[0].toon).toBe(0);
      expect(resParamOff.members[0].contribution).toBe(0);
    });
  });

  // ----------------------------------------------------
  // 2. 식사 대전 오버레이 검증
  // ----------------------------------------------------
  describe("2. 식사 대전 오버레이 실제 점수 연산", () => {
    const mealBattleState: MealBattleState = {
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
    };

    it("2-1. [전체 기간]: 식사 대전 참가자별 후원 점수가 정상적으로 합산된다", () => {
      const scores = recalculateMealParticipantScoresFromDonors(mealBattleState, sampleDonors);
      const s1 = scores.find((p) => p.memberId === "m1")?.score;
      const s2 = scores.find((p) => p.memberId === "m2")?.score;

      console.log("\n[실제 검증 2-1] 식사 대전 전체 기간");
      console.log(`- m1 점수: ${s1?.toLocaleString()}원 (예상 1,554,000원)`);
      console.log(`- m2 점수: ${s2?.toLocaleString()}원 (예상 777,000원)`);

      expect(s1).toBe(1554000);
      expect(s2).toBe(777000);
    });

    it("2-2. [현재/특정 시간부터]: 11:30:00 이후 후원만 식사 대전 게이지에 반영된다", () => {
      const cutoff = 1732156200000; // 11:30:00
      const timedMb = applyMealBattleDonationsFromTime(mealBattleState, sampleDonors, {
        fromAt: cutoff,
      });

      const s1 = timedMb.participants.find((p) => p.memberId === "m1")?.score;
      const s2 = timedMb.participants.find((p) => p.memberId === "m2")?.score;

      console.log("\n[실제 검증 2-2] 식사 대전 특정 시간부터 (11:30:00 이후)");
      console.log(`- m1 점수: ${s1?.toLocaleString()}원 (11시 이전이므로 0원)`);
      console.log(`- m2 점수: ${s2?.toLocaleString()}원 (12시 후원 777,000원 반영)`);

      expect(s1).toBe(0);
      expect(s2).toBe(777000);
    });

    it("2-3. [초기화]: 식사 대전 게이지 점수가 0으로 리셋되고 startedAt이 갱신된다", () => {
      const now = 1732157000000;
      const resetMb = resetMealBattleDonationUi(mealBattleState, now);

      console.log("\n[실제 검증 2-3] 식사 대전 초기화");
      console.log(`- 참가자 점수 리셋: ${resetMb.participants.every((p) => p.score === 0)}`);
      console.log(`- 연동 시작 시각 갱신: ${resetMb.participants.every((p) => p.donationLinkStartedAt === now)}`);

      expect(resetMb.participants.every((p) => p.score === 0)).toBe(true);
      expect(resetMb.participants.every((p) => p.donationLinkStartedAt === now)).toBe(true);
    });

    it("2-4. [책정 OFF]: 참가자의 donationLinkActive = false 설정 시 후원이 들어와도 게이지가 0점으로 고정된다", () => {
      const offMb: MealBattleState = {
        ...mealBattleState,
        participants: mealBattleState.participants.map((p) => ({ ...p, donationLinkActive: false })),
      };

      const scores = recalculateMealParticipantScoresFromDonors(offMb, sampleDonors);
      console.log("\n[실제 검증 2-4] 식사 대전 책정 OFF");
      console.log(`- 모든 참가자 점수 0 확인: ${scores.every((p) => p.score === 0)}`);

      expect(scores.every((p) => p.score === 0)).toBe(true);
    });
  });

  // ----------------------------------------------------
  // 3. 시그 대전 오버레이 검증
  // ----------------------------------------------------
  describe("3. 시그 대전 오버레이 실제 점수 연산", () => {
    const sigSettings: SigMatchSettings = {
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
    };

    it("3-1. [전체 기간 / 특정 시간부터 / 책정 OFF] 동작 검증", () => {
      // 1) 전체 기간
      const rankAll = getSigMatchRankings(sampleDonors, [m1, m2], sigSettings, {}, {});
      const r1 = rankAll.find((r) => r.memberId === "m1")?.score;
      const r2 = rankAll.find((r) => r.memberId === "m2")?.score;

      console.log("\n[실제 검증 3-1] 시그 대전");
      console.log(`- 전체 기간 m1 점수: ${r1?.toLocaleString()}원 (예상 1,554,000원)`);
      console.log(`- 전체 기간 m2 점수: ${r2?.toLocaleString()}원 (예상 777,000원)`);

      expect(r1).toBe(1554000);
      expect(r2).toBe(777000);

      // 2) 특정 시간 (11:30:00 이후)
      const timedSettings = setSigMatchDonationCountFrom(sigSettings, ["m1", "m2"], 1732156200000);
      const rankTimed = getSigMatchRankings(sampleDonors, [m1, m2], timedSettings, {}, {});
      const t1 = rankTimed.find((r) => r.memberId === "m1")?.score;
      const t2 = rankTimed.find((r) => r.memberId === "m2")?.score;

      console.log(`- 11:30 이후 m1 점수: ${t1}원 (0원)`);
      console.log(`- 11:30 이후 m2 점수: ${t2?.toLocaleString()}원 (777,000원)`);

      expect(t1).toBe(0);
      expect(t2).toBe(777000);

      // 3) 책정 OFF
      const offSettings: SigMatchSettings = {
        ...sigSettings,
        donationLinks: {
          m1: { active: false, startedAt: 0 },
          m2: { active: false, startedAt: 0 },
        },
      };
      const rankOff = getSigMatchRankings(sampleDonors, [m1, m2], offSettings, {}, {});
      console.log(`- 책정 OFF 모든 참가자 점수 0 확인: ${rankOff.every((r) => r.score === 0)}`);

      expect(rankOff.every((r) => r.score === 0)).toBe(true);
    });
  });

  // ----------------------------------------------------
  // 4. OBS 오버레이 URL & 프리셋 파라미터 직렬화
  // ----------------------------------------------------
  describe("4. OBS 오버레이 URL & 파라미터 연동", () => {
    it("4-1. OBS URL에 전달된 donationAggregateFromAt 파라미터가 정확히 파싱된다", () => {
      // 1) &donationAggregateFromAt=off
      expect(resolveDonationAggregateFromAt(new URLSearchParams("donationAggregateFromAt=off"), null, { ready: false })).toBe(-1);
      // 2) &donationAggregateFromAt=1732154400000
      expect(resolveDonationAggregateFromAt(new URLSearchParams("donationAggregateFromAt=1732154400000"), null, { ready: false })).toBe(1732154400000);
      // 3) 파라미터 없음 (전체 기간)
      expect(resolveDonationAggregateFromAt(new URLSearchParams(), null, { ready: false })).toBeNull();

      console.log("\n[실제 검증 4-1] OBS URL 파라미터 파싱");
      console.log("- 'off' -> -1 (책정 OFF 판정 성공)");
      console.log("- '1732154400000' -> 1732154400000 (시점 필터 성공)");
      console.log("- '' -> null (전체 기간 성공)\n");
    });
  });
});
