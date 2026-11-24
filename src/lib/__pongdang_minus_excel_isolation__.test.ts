import { describe, it, expect } from "vitest";
import type { AppState, Donor, Member, ContributionLog } from "@/types";
import {
  collectDay777SigContributionByMember,
  applyOverlayDonationDisplayTotals,
  membersWithOverlayDonationAggregate,
} from "./overlay-donation-aggregate";
import { syncMemberTotalsFromDonors } from "@/domain/sync/sync-repair-1pass";

describe("퐁당퐁당 엑셀 마이너스 기여도와 메인 엑셀 분리 검증", () => {
  const members: Member[] = [
    { id: "m1", name: "자키", account: 0, toon: 0, contribution: 50000, operating: false },
    { id: "m2", name: "이나", account: 0, toon: 0, contribution: 30000, operating: false },
  ];

  it("1. pongdangMinus는 퐁당 엑셀에 음수로 표시되고 메인 엑셀에는 영향을 주지 않는다", () => {
    const donors: Donor[] = [
      {
        id: "d1",
        name: "후원자A",
        amount: 777000,
        memberId: "m1",
        target: "account",
        sigPrice: 50000,
        isSigCredit: true,
        pongdangMinus: true, // 퐁당퐁당 엑셀창에서 마이너스 처리됨
      },
    ];

    const state: AppState = {
      members,
      donors,
      contributionLogs: [],
      pongdangManualContributions: {},
      rouletteState: {} as any,
    } as unknown as AppState;

    // A. 퐁당퐁당 팝업창 기준: 마이너스 기여도(-50,000) 정상 계산
    const pdResult = applyOverlayDonationDisplayTotals(state, {
      day777Calc: true,
      isPongdangPopup: true,
    });
    expect(pdResult.members.find((m) => m.id === "m1")?.contribution).toBe(-50000);

    // B. 일반 방송 엑셀표 (day777Calc: false): 후원 원장 그대로 유지, 마이너스 영향 없음
    const mainExcel = applyOverlayDonationDisplayTotals(syncMemberTotalsFromDonors(state), {
      day777Calc: false,
    });
    expect(mainExcel.members.find((m) => m.id === "m1")?.account).toBe(777000);
    // syncMemberTotalsFromDonors도 0 이상 정상 합산
    expect(mainExcel.members.find((m) => m.id === "m1")?.contribution).toBeGreaterThanOrEqual(0);

    // C. 퐁당 엑셀표 (day777Calc: true): 마이너스 기여도를 음수 그대로 표시
    const overlayExcel = applyOverlayDonationDisplayTotals(state, {
      day777Calc: true,
      isPongdangPopup: false,
    });
    expect(overlayExcel.members.find((m) => m.id === "m1")?.contribution).toBe(-50000);
  });

  it("2. 퐁당퐁당 엑셀창에서 추가된 수동 마이너스 로그(delta: -1)가 메인 엑셀표 기여도를 깎지 않는다", () => {
    const pongdangMinusLog: ContributionLog = {
      id: "cl_pd_12345_test",
      memberId: "m1",
      donorName: "관리자 수동",
      amount: 40000,
      delta: -1,
      note: "퐁당퐁당 수동 차감",
      at: Date.now(),
      ...({ isPongdang: true } as any),
    };

    const state: AppState = {
      members,
      donors: [
        {
          id: "d1",
          name: "후원자A",
          amount: 50000,
          memberId: "m1",
          target: "account",
          contributionPoints: 50000,
        },
      ],
      contributionLogs: [pongdangMinusLog],
      pongdangManualContributions: {},
      rouletteState: {} as any,
    } as unknown as AppState;

    // 메인 서버/클라이언트 syncMemberTotalsFromDonors: 퐁당퐁당 마이너스 로그는 메인 기여도에서 차감되지 않음!
    const synced = syncMemberTotalsFromDonors(state);
    expect(synced.members.find((m) => m.id === "m1")?.contribution).toBe(50000);

    // 일반 엑셀표에서도 차감되지 않고 50,000원 유지
    const mainExcel = applyOverlayDonationDisplayTotals(state, {
      day777Calc: false,
    });
    expect(mainExcel.members.find((m) => m.id === "m1")?.contribution).toBe(50000);
  });

  it("3. 수동 음수 보정은 퐁당 엑셀에 표시되고 일반 엑셀에는 영향을 주지 않는다", () => {
    const state: AppState = {
      members: [
        { id: "m1", name: "자키", account: 0, toon: 0, contribution: 0, operating: false },
      ],
      donors: [],
      contributionLogs: [],
      pongdangManualMode: true,
      pongdangManualContributions: {
        m1: -30000, // 퐁당퐁당 전용 음수 보정
      },
      rouletteState: {} as any,
    } as unknown as AppState;

    // 퐁당퐁당 팝업창: -30,000 반영
    const pdResult = applyOverlayDonationDisplayTotals(state, {
      day777Calc: true,
      isPongdangPopup: true,
    });
    expect(pdResult.members.find((m) => m.id === "m1")?.contribution).toBe(-30000);

    // 퐁당 엑셀표(day777Calc=true): 음수 기여도 유지
    const overlayExcel = applyOverlayDonationDisplayTotals(state, {
      day777Calc: true,
      isPongdangPopup: false,
    });
    expect(overlayExcel.members.find((m) => m.id === "m1")?.contribution).toBe(-30000);

    // membersWithOverlayDonationAggregate 도 음수 유지
    const aggMembers = membersWithOverlayDonationAggregate(state, state.members, null, {
      day777Calc: true,
    });
    expect(aggMembers.find((m) => m.id === "m1")?.contribution).toBe(-30000);

    // 일반 엑셀표(day777Calc=false)는 퐁당 수동 보정과 분리되어 0 이상
    const mainExcel = applyOverlayDonationDisplayTotals(state, { day777Calc: false });
    expect(mainExcel.members.find((m) => m.id === "m1")?.contribution).toBe(0);
  });
});
