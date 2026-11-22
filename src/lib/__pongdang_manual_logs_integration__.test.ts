import { describe, expect, it } from "vitest";
import { applyOverlayDonationDisplayTotals } from "./overlay-donation-aggregate";
import type { AppState, Member, ContributionLogItem } from "@/types";

describe("퐁당퐁당 엑셀표 - 기여도 기록부(수동 로그) 및 수동 보정값 상시 합산 검증", () => {
  const baseState: AppState = {
    members: [
      { id: "m1", name: "초화", account: 777000, toon: 0, contribution: 0 },
      { id: "m2", name: "자키", account: 0, toon: 0, contribution: 0 },
    ],
    donors: [
      {
        id: "d1",
        memberId: "m1",
        playerName: "초화",
        donorName: "후원자A",
        amount: 777000,
        at: 1000,
        platform: "bank",
        sigPrice: 50000, // 룰렛 당첨 시그 단가
        isSigCredit: true,
      },
    ],
    // [기여도 기록부]에서 관리자가 수동으로 입력한 내역
    contributionLogs: [
      {
        id: "log1",
        memberId: "m1",
        amount: 30000,
        reason: "미션 달성 보너스",
        at: 2000,
      } as ContributionLogItem,
    ],
    // [퐁당퐁당 수동 보정]에서 입력한 금액
    pongdangManualContributions: {
      m1: 20000,
    },
    pongdangManualMode: true,
  } as unknown as AppState;

  it("퐁당퐁당 엑셀표(day777Calc=true)에서 자동 시그단가(5만) + 기록부 수동로그(3만) + 퐁당 수동보정(2만)이 100% 모두 상시 합산된다", () => {
    const res = applyOverlayDonationDisplayTotals(baseState, { day777Calc: true });
    const m1 = res.members.find((m) => m.id === "m1");
    expect(m1).toBeDefined();

    // 50,000 (시그 단가) + 30,000 (기여도 기록부 수동 로그) + 20,000 (퐁당 수동 보정) = 100,000원
    expect(m1!.contribution).toBe(100000);
  });

  it("퐁당퐁당 수동 보정값이 0원이어도 기여도 기록부 수동 로그가 퐁당퐁당 엑셀표에 정상 반영된다", () => {
    const stateWithoutPongdangManual: AppState = {
      ...baseState,
      pongdangManualContributions: {},
    };
    const res = applyOverlayDonationDisplayTotals(stateWithoutPongdangManual, { day777Calc: true });
    const m1 = res.members.find((m) => m.id === "m1");
    expect(m1).toBeDefined();

    // 50,000 (시그 단가) + 30,000 (기여도 기록부) = 80,000원
    expect(m1!.contribution).toBe(80000);
  });
});
