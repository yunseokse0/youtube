import { describe, expect, it } from "vitest";
import { appendSettlementRecord } from "@/lib/settlement";
import {
  applyRoundContributionToState,
  getRoundContributionSnapshot,
  hasSavedRoundContribution,
} from "@/lib/settlement-contribution-restore";
import type { AppState, Member } from "@/types";

describe("정산 회차 기여도 저장 및 리셋 후 불러오기 테스트", () => {
  const dummyMembers: Member[] = [
    { id: "m1", name: "자키", account: 100000, toon: 200000, contribution: 460000 },
    { id: "m2", name: "열음", account: 50000, toon: 50000, contribution: 20000 },
    { id: "m3", name: "초화", account: 0, toon: 0, contribution: 15000 },
  ];

  it("정산 생성 시 saveRoundContribution: true (기본값)이면 멤버별 기여도와 스냅샷이 저장된다", () => {
    const rec = appendSettlementRecord(
      "1회차 정산",
      dummyMembers,
      0.7,
      0.6,
      0.033,
      undefined,
      undefined,
      "test_user",
      undefined,
      { saveRoundContribution: true }
    );

    expect(rec.saveRoundContribution).toBe(true);
    expect(rec.roundContributionSnapshot).toBeDefined();
    expect(rec.roundContributionSnapshot?.["m1"]).toBe(460000);
    expect(rec.roundContributionSnapshot?.["m2"]).toBe(20000);
    expect(rec.roundContributionSnapshot?.["m3"]).toBe(15000);

    const m1Result = rec.members.find((m) => m.memberId === "m1");
    expect(m1Result?.contribution).toBe(460000);
    expect(hasSavedRoundContribution(rec)).toBe(true);
  });

  it("정산 생성 시 saveRoundContribution: false 이면 기여도가 저장되지 않는다", () => {
    const rec = appendSettlementRecord(
      "기여도 미저장 정산",
      dummyMembers,
      0.7,
      0.6,
      0.033,
      undefined,
      undefined,
      "test_user",
      undefined,
      { saveRoundContribution: false }
    );

    expect(rec.saveRoundContribution).toBe(false);
    expect(rec.roundContributionSnapshot).toBeUndefined();
    expect(hasSavedRoundContribution(rec)).toBe(false);
  });

  it("정산 리셋 후 과거 회차 기여도를 불러오면 members[i].contribution과 퐁당퐁당 수동보정이 정상 복원된다", () => {
    // 1. 과거 정산 레코드 생성
    const savedRec = appendSettlementRecord(
      "지난 회차 정산",
      dummyMembers,
      0.7,
      0.6,
      0.033,
      undefined,
      undefined,
      "test_user",
      undefined,
      { saveRoundContribution: true }
    );

    // 2. 리셋된 AppState (기여도 0원)
    const resetState: AppState = {
      members: [
        { id: "m1", name: "자키", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "열음", account: 0, toon: 0, contribution: 0 },
        { id: "m3", name: "초화", account: 0, toon: 0, contribution: 0 },
      ],
      memberPositions: {},
      memberPositionMode: "fixed",
      rankPositionLabels: [],
      donorRankingsTheme: {} as any,
      donorRankingsFullTheme: {} as any,
      donorRankingsPresets: [],
      donors: [],
      contributionLogs: [],
      restroomLogs: [],
      forbiddenWords: [],
      sigInventory: [],
      sigSoldOutStampUrl: "",
      sigSalesMemberPresets: {},
      rouletteState: {} as any,
      sigMatch: {},
      sigMatchSettings: {} as any,
      mealBattle: {} as any,
      mealMatch: {},
      mealMatchSettings: {} as any,
      generalTimer: {} as any,
      matchTimer: {} as any,
      matchTimerEnabled: {} as any,
      timerDisplayStyles: {} as any,
      donorRankingsOverlayConfig: {} as any,
      donorRankingsFullOverlayConfig: {} as any,
      donationListsOverlayConfig: {} as any,
      sigSalesExcludedIds: [],
      sigRolling: {} as any,
      updatedAt: 1000,
    };

    // 3. 기여도 불러오기 적용
    const { nextState, restoredCount, restoredTotal } = applyRoundContributionToState(
      resetState,
      savedRec
    );

    expect(restoredCount).toBe(3);
    expect(restoredTotal).toBe(460000 + 20000 + 15000);

    const m1 = nextState.members.find((m) => m.id === "m1");
    const m2 = nextState.members.find((m) => m.id === "m2");
    const m3 = nextState.members.find((m) => m.id === "m3");

    expect(m1?.contribution).toBe(460000);
    expect(m2?.contribution).toBe(20000);
    expect(m3?.contribution).toBe(15000);

    // 과거 회차 기여도는 기존 엑셀표(members[i].contribution)에만 저장되고 퐁당퐁당은 오염되지 않음
    expect(nextState.pongdangManualMode).toBeUndefined();
    expect(nextState.pongdangManualContributions).toBeUndefined();

    // 복원 로그가 생성되었는지 확인
    expect(nextState.contributionLogs.length).toBe(3);
    expect(nextState.contributionLogs[0].note).toContain("회차 기여도 불러오기");
  });
});
