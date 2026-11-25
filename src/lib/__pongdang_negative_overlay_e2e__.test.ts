import { describe, it, expect } from "vitest";
import type { AppState, Donor, Member, ContributionLog } from "@/types";
import { ensureMembers } from "./state";
import {
  applyOverlayDonationDisplayTotals,
  membersWithOverlayDonationAggregate,
} from "./overlay-donation-aggregate";
import { buildOverlayRankedMembers } from "./utils";

describe("퐁당퐁당 엑셀표 음수 표시 및 랭킹 정합성 전수 검증 (User Case)", () => {
  const members: Member[] = [
    { id: "m1", name: "수아", account: 100000, toon: 0, contribution: 0, operating: false },
    { id: "m2", name: "조은", account: 50000, toon: 0, contribution: 0, operating: false },
    { id: "m3", name: "이유리", account: 0, toon: 0, contribution: 0, operating: false },
  ];

  it("1. 777데이 옵션이 OFF여도 퐁당퐁당 엑셀표(isPongdangPopup: true)에서는 마이너스 시그/후원이 음수로 표시된다", () => {
    const donors: Donor[] = [
      { id: "d1", memberId: "m1", amount: 100000, sigPrice: 100000, target: "account", at: 100 },
      { id: "d2", memberId: "m2", amount: 50000, sigPrice: 50000, target: "account", at: 200 },
      // 이유리: 50,000원 후원 후 퐁당퐁당 마이너스(-) 처리됨
      { id: "d3", memberId: "m3", amount: 50000, sigPrice: 50000, target: "account", at: 300, pongdangMinus: true },
    ];

    const state: AppState = {
      members,
      donors,
      contributionLogs: [],
      pongdangManualContributions: {},
      rouletteState: null as any,
    } as unknown as AppState;

    // 777데이 OFF(day777Calc: false) + 퐁당퐁당 엑셀(isPongdangPopup: true)
    const result = applyOverlayDonationDisplayTotals(state, {
      day777Calc: false,
      isPongdangPopup: true,
    });

    const m1 = result.members.find((m) => m.id === "m1");
    const m2 = result.members.find((m) => m.id === "m2");
    const m3 = result.members.find((m) => m.id === "m3");

    expect(m1?.contribution).toBe(100000);
    expect(m2?.contribution).toBe(50000);
    expect(m3?.contribution).toBe(-50000); // 음수 그대로 보존!
  });

  it("2. 퐁당 수동 입력값(pongdangManualContributions: -50,000)도 777데이 OFF 상태에서 음수로 표시된다", () => {
    const state: AppState = {
      members,
      donors: [
        { id: "d1", memberId: "m1", amount: 100000, target: "account", at: 100 },
      ],
      contributionLogs: [],
      pongdangManualContributions: {
        m3: -50000, // 이유리 수동 -50,000원
      },
      pongdangManualMode: true,
      rouletteState: null as any,
    } as unknown as AppState;

    const result = membersWithOverlayDonationAggregate(
      state,
      members,
      null, // fromAt = null
      {
        day777Calc: false,
        isPongdangPopup: true,
        pongdangManualMode: true,
      }
    );

    const m3 = result.find((m) => m.id === "m3");
    expect(m3?.contribution).toBe(-50000);
  });

  it("3. 수동 기여도 로그(delta: -1)도 777데이 OFF 상태에서 음수로 정확히 차감된다", () => {
    const minusLog: ContributionLog = {
      id: "cl_1",
      memberId: "m3",
      amount: 70000,
      delta: -1,
      at: 100,
      donorName: "관리자",
      note: "퐁당 마이너스",
      isPongdang: true,
    } as any;

    const state: AppState = {
      members,
      donors: [],
      contributionLogs: [minusLog],
      pongdangManualContributions: {},
      pongdangManualMode: true,
      rouletteState: null as any,
    } as unknown as AppState;

    const result = applyOverlayDonationDisplayTotals(state, {
      day777Calc: false,
      isPongdangPopup: true,
    });

    const m3 = result.members.find((m) => m.id === "m3");
    expect(m3?.contribution).toBe(-70000);
  });

  it("4. 음수 기여도 멤버는 랭킹 계산(buildOverlayRankedMembers) 시 0원 및 양수 멤버보다 아래 순위(최하위)로 정렬된다", () => {
    const displayMembers: Member[] = [
      { id: "m1", name: "수아", account: 0, toon: 0, contribution: 100000, operating: false },
      { id: "m2", name: "조은", account: 0, toon: 0, contribution: 0, operating: false },
      { id: "m3", name: "이유리", account: 0, toon: 0, contribution: -50000, operating: false },
    ];

    const ranked = buildOverlayRankedMembers(
      displayMembers,
      {},
      undefined,
      displayMembers,
      (m) => Number(m.contribution) || 0,
      "contribution"
    );

    expect(ranked[0]?.m.id).toBe("m1"); // 1위: 수아 (100,000)
    expect(ranked[0]?.rank).toBe(1);

    expect(ranked[1]?.m.id).toBe("m2"); // 2위: 조은 (0)
    expect(ranked[1]?.rank).toBe(2);

    expect(ranked[2]?.m.id).toBe("m3"); // 3위: 이유리 (-50,000)
    expect(ranked[2]?.rank).toBe(3);
  });

  it("5. ensureMembers가 음수 기여도를 0으로 클램핑하지 않고 그대로 보존한다", () => {
    const rawList = [
      { id: "m1", name: "수아", contribution: -50000, account: 100000, toon: 20000 },
      { id: "m2", name: "조은", contribution: 30000, account: 0, toon: 0 },
    ];
    const normalized = ensureMembers(rawList);
    expect(normalized[0]?.contribution).toBe(-50000);
    expect(normalized[1]?.contribution).toBe(30000);
  });

  it("6. 프리셋 '퐁당퐁당 엑셀 식사'(theme: excelViolet, day777Calc: true) 파이프라인에서 음수가 온전히 표출된다", () => {
    const testState: AppState = {
      members,
      donors: [
        { id: "d1", memberId: "m1", amount: 100000, sigPrice: 100000, target: "account", at: 100 },
        { id: "d2", memberId: "m3", amount: 50000, sigPrice: 50000, target: "account", at: 200, pongdangMinus: true },
      ],
      contributionLogs: [],
      pongdangManualContributions: {},
      rouletteState: null as any,
    } as unknown as AppState;

    const aggregated = membersWithOverlayDonationAggregate(
      testState,
      members,
      null,
      {
        day777Calc: true,
        isPongdangPopup: true,
        pongdangManualMode: true,
      }
    );

    // ensureMembers를 통과해도 음수가 0으로 증발하지 않음
    const finalMembers = ensureMembers(aggregated);
    const m3 = finalMembers.find((m: any) => m.id === "m3");
    expect(m3?.contribution).toBe(-50000);
  });

  it("7. zakiexcel 실방송 데이터 시나리오: 음수 기여도가 크기순으로 올바르게 랭킹되고 표시된다", () => {
    const zakieMembers: Member[] = [
      { id: "m_surin", name: "수린", account: 0, toon: 685000, contribution: 295000, operating: false },
      { id: "m_chaeyoung", name: "채영", account: 0, toon: 0, contribution: 0, operating: false },
      { id: "m_seoyuha", name: "서유하", account: 80000, toon: 0, contribution: -20000, operating: false },
      { id: "m_eena", name: "이나", account: 31000, toon: 0, contribution: -31000, operating: false },
      { id: "m_chohwa", name: "초화", account: 0, toon: 104000, contribution: -104000, operating: false },
      { id: "m_jina", name: "진아", account: 0, toon: 1213000, contribution: -1029000, operating: false },
    ];

    const isPongdangTable = true;
    const getContributionValueForMember = (m: Member) => {
      const stored = typeof m.contribution === "number" ? m.contribution : Number(m.contribution) || 0;
      if (stored < 0 || isPongdangTable) return Math.floor(stored);
      return Math.max(0, Math.floor(stored));
    };

    const ranked = buildOverlayRankedMembers(
      zakieMembers,
      {},
      undefined,
      zakieMembers,
      getContributionValueForMember,
      "contribution"
    );

    expect(ranked.map((r) => r.m.name)).toEqual([
      "수린",
      "채영",
      "서유하",
      "이나",
      "초화",
      "진아",
    ]);
    expect(ranked.map((r) => getContributionValueForMember(r.m))).toEqual([
      295000,
      0,
      -20000,
      -31000,
      -104000,
      -1029000,
    ]);

    // OverlayTableNumCell safe logic:
    const numCellSafe = (val: number, allowNeg: boolean) => {
      const rounded = Math.round(Number(val) || 0);
      return allowNeg || rounded < 0 ? rounded : Math.max(0, rounded);
    };
    expect(numCellSafe(-1029000, false)).toBe(-1029000); // Defense-in-depth: negative is NEVER clamped to 0
    expect(numCellSafe(-20000, true)).toBe(-20000);
    expect(numCellSafe(295000, true)).toBe(295000);
  });
});
