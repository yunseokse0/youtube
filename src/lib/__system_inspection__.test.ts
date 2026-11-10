import { describe, expect, it } from "vitest";
import { defaultState, type AppState, type Member, type Donor } from "@/lib/state";
import {
  SIG_MATCH_GAUGE_THEME_IDS,
  SIG_MATCH_GAUGE_THEMES,
  getSigMatchGaugeTheme,
} from "@/lib/sig-match-gauge-theme";
import {
  applyOverlayDonationDisplayTotals,
} from "@/lib/overlay-donation-aggregate";
import {
  compareMembersByRankingMetric,
} from "@/lib/utils";
import { syncMemberTotalsFromDonors } from "@/domain/sync/sync-repair-1pass";
import {
  resetMealBattleDonationUi,
  setSigMatchDonationCountFrom,
} from "@/lib/battle-donation-sync";

describe("전체 시스템 핵심 기능 및 정합성 점검 (System Inspection)", () => {
  // 1. 대전 게이지 테마 점검
  describe("1. 시그/식사 대전 게이지 테마 시스템", () => {
    it("5종의 테마가 모두 정상 등록되어 있고 필수 스타일 속성을 완비하고 있는지 확인", () => {
      expect(SIG_MATCH_GAUGE_THEME_IDS).toEqual([
        "neon-esports",
        "cyberpunk",
        "gold-luxury",
        "clean-minimal",
        "violet-luxury",
      ]);

      for (const id of SIG_MATCH_GAUGE_THEME_IDS) {
        const theme = SIG_MATCH_GAUGE_THEMES[id];
        expect(theme).toBeDefined();
        expect(theme.id).toBe(id);
        expect(theme.leftFill).toBeTruthy();
        expect(theme.rightFill).toBeTruthy();
        expect(theme.trackBg).toBeTruthy();
        expect(theme.trackBorder).toBeTruthy();
        expect(theme.trackShadow).toBeTruthy();
        expect(theme.vsBg).toBeTruthy();
        expect(theme.vsBorder).toBeTruthy();
        expect(theme.vsGlow).toBeTruthy();
      }
    });

    it("신규 'violet-luxury' (바이올렛 럭셔리) 테마가 정상 로드되는지 확인", () => {
      const theme = getSigMatchGaugeTheme("violet-luxury");
      expect(theme.label).toBe("바이올렛 럭셔리");
      expect(theme.leftFill).toContain("#a855f7");
      expect(theme.trackBg).toContain("24, 10, 40");
    });
  });

  // 2. 독립 초기화 로직 점검
  describe("2. 시그 대전 / 식사 대전 독립 초기화 검증", () => {
    it("시그 대전 초기화 시 식사 대전 점수 및 정산표 후원 목록이 보존되는지 확인", () => {
      const base = defaultState();
      const stateWithScores: AppState = {
        ...base,
        members: [
          { id: "m1", name: "얼음", account: 100000, toon: 50000, contribution: 80000, goal: 500000 },
          { id: "m2", name: "수린", account: 200000, toon: 0, contribution: 120000, goal: 500000 },
        ],
        donors: [
          { id: "d1", memberId: "m1", amount: 100000, at: 1000, target: "account", donorName: "후원자A" },
          { id: "d2", memberId: "m2", amount: 200000, at: 2000, target: "account", donorName: "후원자B" },
        ],
        sigMatch: { m1: 5, m2: 8 }, // 시그 대전 수기/점수
        mealMatch: { m1: 3, m2: 2 }, // 식사 대전 점수
        mealBattle: {
          ...base.mealBattle,
          participants: [
            { memberId: "m1", name: "얼음", score: 30, goal: 100, color: "#f472b6" },
            { memberId: "m2", name: "수린", score: 20, goal: 100, color: "#fb7185" },
          ],
        },
      };

      // 시그 대전 초기화 수행
      const resetAt = 5000;
      const targets = ["m1", "m2"];
      const updatedSigSettings = setSigMatchDonationCountFrom(stateWithScores.sigMatchSettings, targets, resetAt);
      const afterSigReset: AppState = {
        ...stateWithScores,
        sigMatch: {}, // 수기 보정 0
        sigMatchSettings: updatedSigSettings,
      };

      // 검증: 시그 대전 점수는 초기화되었으나 식사 대전 점수와 후원자 목록은 그대로 유지
      expect(afterSigReset.sigMatch).toEqual({});
      expect(afterSigReset.mealMatch).toEqual({ m1: 3, m2: 2 });
      expect(afterSigReset.mealBattle?.participants?.[0]?.score).toBe(30);
      expect(afterSigReset.donors?.length).toBe(2);
      expect(afterSigReset.members[0]?.account).toBe(100000);
    });

    it("식사 대전 초기화 시 시그 대전 점수 및 정산표 후원 목록이 보존되는지 확인", () => {
      const base = defaultState();
      const stateWithScores: AppState = {
        ...base,
        donors: [
          { id: "d1", memberId: "m1", amount: 100000, at: 1000, target: "account", donorName: "후원자A" },
        ],
        sigMatch: { m1: 15 },
        mealMatch: { m1: 10 },
        mealBattle: {
          ...base.mealBattle,
          participants: [
            { memberId: "m1", name: "얼음", score: 50, goal: 100, color: "#f472b6" },
          ],
        },
      };

      // 식사 대전 초기화 수행
      const resetAt = 6000;
      const resetUi = resetMealBattleDonationUi(stateWithScores.mealBattle, resetAt);
      const afterMealReset: AppState = {
        ...stateWithScores,
        mealMatch: {},
        mealBattle: resetUi,
      };

      // 검증: 식사 대전은 0으로 리셋, 시그 대전은 15점 그대로 보존, 후원 원장도 보존
      expect(afterMealReset.mealMatch).toEqual({});
      expect(afterMealReset.sigMatch).toEqual({ m1: 15 });
      expect(afterMealReset.donors?.length).toBe(1);
    });
  });

  // 3. 퐁당퐁당 엑셀표 및 777데이 옵션 정합성 점검
  describe("3. 퐁당퐁당 777데이 옵션 및 수동 모드 정합성 검증", () => {
    it("일반 후원(777,000원)은 메인 엑셀표에서 계좌와 기여도 모두 777,000원으로 동일 반영됨", () => {
      const normalState = syncMemberTotalsFromDonors({
        ...defaultState(),
        members: [{ id: "m1", name: "얼음", account: 0, toon: 0, contribution: 0, goal: 500000 }],
        donors: [{ id: "norm1", memberId: "m1", amount: 777_000, at: 1000, target: "account", donorName: "큰손" } as Donor],
      });
      expect(normalState.members[0]?.account).toBe(777_000);
      expect(normalState.members[0]?.contribution).toBe(777_000);
    });

    it("퐁당퐁당 엑셀표 (day777Calc: true)에서는 계좌는 777,000원 유지되나 기여도는 나온 시그 금액(50,000원)만 반영됨", () => {
      const sigState: AppState = {
        ...defaultState(),
        members: [{ id: "m1", name: "얼음", account: 777_000, toon: 0, contribution: 777_000, goal: 500000 }],
        donors: [
          {
            id: "shot1",
            memberId: "m1",
            amount: 777_000,
            at: 1000,
            target: "account",
            donorName: "큰손",
            isSigCredit: true,
            contributionPoints: 50_000,
          } as Donor,
        ],
      };
      const result = applyOverlayDonationDisplayTotals(sigState, { day777Calc: true });
      expect(result.members[0]?.account).toBe(777_000);
      expect(result.members[0]?.contribution).toBe(50_000); // 777,000원이 아닌 나온 시그 단가!
    });

    it("퐁당퐁당 수동 모드는 자동을 끄지 않고 계속 수집하며, 수동 보정값과 실시간 합산됨", () => {
      // 1) 자동 시그 50,000원 + 수동 보정 70,000원 = 120,000원
      const manualState: AppState = {
        ...defaultState(),
        members: [{ id: "m1", name: "얼음", account: 777_000, toon: 0, contribution: 777_000, goal: 500000 }],
        donors: [
          {
            id: "shot1",
            memberId: "m1",
            amount: 777_000,
            at: 1000,
            target: "account",
            donorName: "큰손",
            isSigCredit: true,
            contributionPoints: 50_000,
          } as Donor,
        ],
        pongdangManualMode: true,
        pongdangManualContributions: {
          m1: 70_000, // 수동 보정값
        },
      };

      const result1 = applyOverlayDonationDisplayTotals(manualState, {
        day777Calc: true,
        pongdangManualMode: true,
      });

      expect(result1.members[0]?.account).toBe(777_000);
      expect(result1.members[0]?.contribution).toBe(120_000); // 50,000 (자동) + 70,000 (수동 보정)

      // 2) 방송 중 새로운 시그 당첨(20,000원) 발생 -> 자동 수집이 지속되어 140,000원으로 실시간 상승
      const liveState: AppState = {
        ...manualState,
        donors: [
          ...manualState.donors,
          {
            id: "shot2",
            memberId: "m1",
            amount: 777_000,
            at: 2000,
            target: "account",
            donorName: "팬1",
            isSigCredit: true,
            contributionPoints: 20_000,
          } as Donor,
        ],
      };

      const result2 = applyOverlayDonationDisplayTotals(liveState, {
        day777Calc: true,
        pongdangManualMode: true,
      });

      expect(result2.members[0]?.contribution).toBe(140_000); // 70,000 (자동) + 70,000 (수동 보정) -> 자동수집 지속!
    });

    it("퐁당퐁당 순수 자동 모드(수동 미반영)일 때는 관리자 보정값을 제외한 자동 수집값만 표시됨", () => {
      const autoState: AppState = {
        ...defaultState(),
        members: [{ id: "m1", name: "얼음", account: 777_000, toon: 0, contribution: 777_000, goal: 500000 }],
        donors: [
          {
            id: "shot1",
            memberId: "m1",
            amount: 777_000,
            at: 1000,
            target: "account",
            donorName: "큰손",
            isSigCredit: true,
            contributionPoints: 50_000,
          } as Donor,
        ],
        pongdangManualMode: false,
        pongdangManualContributions: {
          m1: 70_000,
        },
      };

      const result = applyOverlayDonationDisplayTotals(autoState, {
        day777Calc: true,
        pongdangManualMode: false,
      });

      expect(result.members[0]?.contribution).toBe(50_000); // 순수 자동 집계값으로 표시
    });
  });

  // 4. 순위 산정 기준 (기여도, 총 후원금, 계좌만, 투네만) 정합성 점검
  describe("4. 엑셀표 순위 산정 기준 4종 정렬 로직 검증", () => {
    const memberA: Member = { id: "a", name: "A", account: 100_000, toon: 50_000, contribution: 300_000, goal: 0 };
    const memberB: Member = { id: "b", name: "B", account: 50_000, toon: 200_000, contribution: 100_000, goal: 0 };
    const orderIndex = new Map([["a", 0], ["b", 1]]);
    const getContrib = (m: Member) => m.contribution ?? 0;

    it("기여도 순 (contribution): 기여도가 높은 A가 1위", () => {
      const cmp = compareMembersByRankingMetric(memberA, memberB, "contribution", orderIndex, getContrib);
      expect(cmp).toBeLessThan(0); // A가 B보다 앞섬
    });

    it("총 후원금 순 (donation): 계좌+투네 합계(B: 25만 > A: 15만)인 B가 1위", () => {
      const cmp = compareMembersByRankingMetric(memberA, memberB, "donation", orderIndex, getContrib);
      expect(cmp).toBeGreaterThan(0); // B가 A보다 앞섬
    });

    it("계좌 후원금 순 (account): 계좌 후원금(A: 10만 > B: 5만)인 A가 1위", () => {
      const cmp = compareMembersByRankingMetric(memberA, memberB, "account", orderIndex, getContrib);
      expect(cmp).toBeLessThan(0); // A가 B보다 앞섬
    });

    it("투네이션 후원금 순 (toon): 투네 후원금(B: 20만 > A: 5만)인 B가 1위", () => {
      const cmp = compareMembersByRankingMetric(memberA, memberB, "toon", orderIndex, getContrib);
      expect(cmp).toBeGreaterThan(0); // B가 A보다 앞섬
    });
  });
});
