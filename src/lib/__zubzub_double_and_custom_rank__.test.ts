import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AppState, Member, ContributionLog } from "@/types";
import { createZubzubBonusContributionLog } from "@/lib/zubzub/zubzub-engine";
import { collectDay777SigContributionByMember } from "@/lib/overlay-donation-aggregate";
import { collectPongdangPopupAutoContributionByMember } from "@/lib/pongdang-popup-contribution";
import { mergeDonationApplyBase } from "@/domain/merge/apply-6branches.all";
import { syncMemberTotalsFromDonors } from "@/domain/sync/sync-repair-1pass";

describe("줍줍 2배 기여도 및 퐁당퐁당 옵션 & 커스텀 열 순위 모드 검증", () => {
  const members: Member[] = [
    { id: "m_rep", name: "대표", account: 0, toon: 0, operating: true },
    { id: "m_jina", name: "진아", account: 0, toon: 0, operating: false },
    { id: "m_surin", name: "수린", account: 0, toon: 0, operating: false },
  ];

  it("1. createZubzubBonusContributionLog는 doubleContribution 기본값(true)일 때 2배 기여도를 생성한다", () => {
    const log = createZubzubBonusContributionLog("q_1", "m_jina", 50000, "NO BATIDÃO", Date.now(), {
      doubleContribution: true,
      baseSigPrice: 50000,
      multiplier: 2,
    });
    expect(log.amount).toBe(100000);
    expect(log.baseSigPrice).toBe(50000);
    expect(log.multiplier).toBe(2);
    expect(log.note).toContain("100,000점 [2배 적용]");
  });

  it("2. createZubzubBonusContributionLog는 doubleContribution=false일 때 1배 기여도를 생성한다", () => {
    const log = createZubzubBonusContributionLog("q_2", "m_jina", 50000, "NO BATIDÃO", Date.now(), {
      doubleContribution: false,
      baseSigPrice: 50000,
      multiplier: 1,
    });
    expect(log.amount).toBe(50000);
    expect(log.baseSigPrice).toBe(50000);
    expect(log.multiplier).toBe(1);
    expect(log.note).not.toContain("[2배 적용]");
  });

  it("3. 일반 엑셀표(syncMemberTotalsFromDonors)는 2배 보너스(100,000)를 멤버 기여도에 전액 반영한다", () => {
    const log = createZubzubBonusContributionLog("q_1", "m_jina", 50000, "NO BATIDÃO", Date.now(), {
      doubleContribution: true,
      baseSigPrice: 50000,
      multiplier: 2,
    });
    const state: AppState = {
      members,
      donors: [],
      contributionLogs: [log],
    } as any;
    const synced = syncMemberTotalsFromDonors(state);
    const jina = synced.members.find((m) => m.id === "m_jina");
    expect(jina?.contribution).toBe(100000);
  });

  it("4. 퐁당퐁당(applyDoubleContributionToPongdang: true 기본값)은 2배 보너스를 퐁당퐁당 기여도에 반영한다", () => {
    const log: ContributionLog = {
      id: "zubzub_bonus_q_1",
      memberId: "m_jina",
      amount: 100000,
      baseSigPrice: 50000,
      multiplier: 2,
      delta: 1,
      isZubzubBonus: true,
      at: Date.now(),
    };
    const state: AppState = {
      members,
      donors: [],
      contributionLogs: [log],
      zubzubSettings: {
        enabled: true,
        minSigPrice: 1000,
        applyContributionToPongdang: true,
        applyDoubleContributionToPongdang: true,
      },
    } as any;

    const overlayMap = collectDay777SigContributionByMember(state, []);
    expect(overlayMap.get("m_jina")).toBe(100000);

    const popupMap = collectPongdangPopupAutoContributionByMember(state);
    expect(popupMap.get("m_jina")).toBe(100000);
  });

  it("5. 퐁당퐁당(applyDoubleContributionToPongdang: false)은 1배(50,000)만 퐁당퐁당 기여도에 반영한다", () => {
    const log: ContributionLog = {
      id: "zubzub_bonus_q_1",
      memberId: "m_jina",
      amount: 100000,
      baseSigPrice: 50000,
      multiplier: 2,
      delta: 1,
      isZubzubBonus: true,
      at: Date.now(),
    };
    const state: AppState = {
      members,
      donors: [],
      contributionLogs: [log],
      zubzubSettings: {
        enabled: true,
        minSigPrice: 1000,
        applyContributionToPongdang: true,
        applyDoubleContributionToPongdang: false, // 퐁당퐁당에는 2배 미적용!
      },
    } as any;

    // 퐁당퐁당에서는 1배(50,000)만 반영!
    const overlayMap = collectDay777SigContributionByMember(state, []);
    expect(overlayMap.get("m_jina")).toBe(50000);

    const popupMap = collectPongdangPopupAutoContributionByMember(state);
    expect(popupMap.get("m_jina")).toBe(50000);

    // 반면 일반 엑셀 기여도는 여전히 2배(100,000) 유지!
    const synced = syncMemberTotalsFromDonors(state);
    expect(synced.members.find((m) => m.id === "m_jina")?.contribution).toBe(100000);
  });

  it("6. 퐁당퐁당(applyContributionToPongdang: false)은 줍줍 보너스를 완전히 제외한다 (0점)", () => {
    const log: ContributionLog = {
      id: "zubzub_bonus_q_1",
      memberId: "m_jina",
      amount: 100000,
      baseSigPrice: 50000,
      multiplier: 2,
      delta: 1,
      isZubzubBonus: true,
      at: Date.now(),
    };
    const state: AppState = {
      members,
      donors: [],
      contributionLogs: [log],
      zubzubSettings: {
        enabled: true,
        minSigPrice: 1000,
        applyContributionToPongdang: false, // 퐁당퐁당에서 줍줍 제외
      },
    } as any;

    const overlayMap = collectDay777SigContributionByMember(state, []);
    expect(overlayMap.get("m_jina") || 0).toBe(0);

    const popupMap = collectPongdangPopupAutoContributionByMember(state);
    expect(popupMap.get("m_jina") || 0).toBe(0);
  });

  it("7. mergeDonationApplyBase는 customCellMode를 안전하게 보존한다", () => {
    const fresh: any = { customCellMode: "rank", rankCustomCells: ["일반", "쓰레기"] };
    const hint: any = { customCellMode: "member", rankCustomCells: ["기타"] };
    const merged = mergeDonationApplyBase(fresh, hint, []);
    expect(merged.customCellMode).toBe("rank");
  });

  it("8. wire overlay payload에 contributionLogs가 없고 zubzubContributionLogs만 있어도 syncMemberTotalsFromDonors에서 기여도가 정상 반영된다", () => {
    const log: ContributionLog = {
      id: "zubzub_bonus_q_1",
      memberId: "m_jina",
      amount: 104000,
      baseSigPrice: 52000,
      multiplier: 2,
      delta: 1,
      isZubzubBonus: true,
      at: Date.now(),
    };
    const wireState: any = {
      members,
      donors: [],
      // contributionLogs는 와이어에서 생략됨
      zubzubContributionLogs: [log],
    };
    const synced = syncMemberTotalsFromDonors(wireState);
    const jina = synced.members.find((m) => m.id === "m_jina");
    expect(jina?.contribution).toBe(104000);
  });

  it("9. wire overlay payload에서 zubzubContributionLogs만 있어도 퐁당퐁당 popupAuto에 정상 합산된다", () => {
    const log: ContributionLog = {
      id: "zubzub_bonus_q_1",
      memberId: "m_jina",
      amount: 104000,
      baseSigPrice: 52000,
      multiplier: 2,
      delta: 1,
      isZubzubBonus: true,
      at: Date.now(),
    };
    const wireState: any = {
      members,
      donors: [],
      zubzubContributionLogs: [log],
      zubzubSettings: {
        enabled: true,
        applyContributionToPongdang: true,
        applyDoubleContributionToPongdang: true,
      },
    };
    const popupMap = collectPongdangPopupAutoContributionByMember(wireState);
    expect(popupMap.get("m_jina")).toBe(104000);
  });

  it("10. mergePartialState는 패치에 빈 contributionLogs가 들어와도 base의 줍줍 보너스 로그를 보존한다", async () => {
    const { mergePartialState } = await import("@/shell/state/state-save-shared");
    const log: ContributionLog = {
      id: "zubzub_bonus_q_1",
      memberId: "m_jina",
      amount: 104000,
      baseSigPrice: 52000,
      multiplier: 2,
      delta: 1,
      isZubzubBonus: true,
      at: Date.now(),
    };
    const baseState: any = {
      members,
      donors: [],
      contributionLogs: [log],
    };
    // 관리자 브라우저가 autosave 하면서 빈 contributionLogs [] 를 보냈을 때
    const patch: any = {
      contributionLogs: [],
    };
    const merged = mergePartialState(baseState, patch, "zakiexcel");
    expect(merged.contributionLogs).toHaveLength(1);
    expect(merged.contributionLogs?.[0].id).toBe("zubzub_bonus_q_1");
  });

  it("11. applyOverlayDonationDisplayTotals는 퐁당퐁당 표에서 수동 기여도 추가/마이너스 로그(cl_pd_)를 정확히 반영한다", async () => {
    const { applyOverlayDonationDisplayTotals } = await import("@/lib/overlay-donation-aggregate");
    const manualLog: ContributionLog = {
      id: "cl_pd_1795589000_test",
      memberId: "m_jina",
      amount: 50000,
      delta: -1,
      note: "게 미션 실패 벌금",
      at: Date.now(),
      isPongdang: true,
    } as any;
    const testState: any = {
      members: [
        { id: "m_jina", name: "진아", contribution: 0 },
      ],
      donors: [],
      contributionLogs: [manualLog],
      pongdangManualMode: true,
      pongdangManualContributions: {},
    };
    const res = applyOverlayDonationDisplayTotals(testState, { isPongdangPopup: true });
    const jina = res.members.find((m) => m.id === "m_jina");
    expect(jina?.contribution).toBe(-50000);
  });

  it("12. overlay API pick은 수동 퐁당퐁당 기여도 로그를 contributionLogs에 포함하여 오버레이에 전달한다", async () => {
    const { projectStateForGetPick, STATE_PICK_OVERLAY } = await import("@/lib/state-api-pick");
    const manualLog: ContributionLog = {
      id: "cl_pd_1795589000_test",
      memberId: "m_jina",
      amount: 50000,
      delta: -1,
      note: "게 미션 실패 벌금",
      at: Date.now(),
      isPongdang: true,
    } as any;
    const testState: any = {
      members: [
        { id: "m_jina", name: "진아", contribution: 0 },
      ],
      donors: [],
      contributionLogs: [manualLog],
    };
    const projected: any = projectStateForGetPick(testState, STATE_PICK_OVERLAY);
    expect(projected.contributionLogs).toHaveLength(1);
    expect(projected.contributionLogs[0].id).toBe("cl_pd_1795589000_test");
    expect(projected.contributionLogs[0].amount).toBe(50000);
    expect(projected.contributionLogs[0].delta).toBe(-1);
  });

  it("13. mergePartialState는 관리자 일반 수동 기여도 로그(cl_...)도 autosave 시 보존한다", async () => {
    const { mergePartialState } = await import("@/shell/state/state-save-shared");
    const manualLog: ContributionLog = {
      id: "cl_1795590003000_abcd",
      memberId: "m3",
      amount: 50000,
      delta: 1,
      note: "수동 추가",
      at: Date.now(),
    };
    const baseState: any = {
      members,
      donors: [],
      contributionLogs: [manualLog],
    };
    const patch: any = {
      contributionLogs: [],
    };
    const merged = mergePartialState(baseState, patch, "zakiexcel");
    expect(merged.contributionLogs).toHaveLength(1);
    expect(merged.contributionLogs?.[0].id).toBe("cl_1795590003000_abcd");
    expect(merged.contributionLogs?.[0].amount).toBe(50000);
  });

  it("14. mergeDonationApplyBase는 existing(hint)에 존재하는 기여도 로그를 fresh(incoming)와 유니온 병합한다", async () => {
    const { mergeDonationApplyBase } = await import("@/domain/merge/apply-6branches.all");
    const hintLog: ContributionLog = {
      id: "cl_1795590003000_abcd",
      memberId: "m3",
      amount: 50000,
      delta: 1,
      note: "수동 추가",
      at: Date.now(),
    };
    const freshLog: ContributionLog = {
      id: "cl_1795591256000_efgh",
      memberId: "m_1795422063042_9sje4",
      amount: 31000,
      delta: 1,
      note: "",
      at: Date.now(),
    };
    const hint: any = {
      members,
      donors: [],
      contributionLogs: [hintLog],
    };
    const fresh: any = {
      members,
      donors: [],
      contributionLogs: [freshLog],
    };
    const merged = mergeDonationApplyBase(fresh, hint);
    expect(merged.contributionLogs).toHaveLength(2);
    const ids = merged.contributionLogs.map((l: any) => l.id);
    expect(ids).toContain("cl_1795590003000_abcd");
    expect(ids).toContain("cl_1795591256000_efgh");
  });

  it("15. syncAndRepairMemberTotals는 운영비/직급 멤버(실장/대표)에게 수동 기여도 로그가 추가되면 기여도를 반영한다", async () => {
    const { syncAndRepairMemberTotals } = await import("@/domain/sync/sync-repair-1pass");
    const manualLog: ContributionLog = {
      id: "cl_1795590003000_abcd",
      memberId: "m3",
      amount: 50000,
      delta: 1,
      note: "수동 추가",
      at: Date.now(),
    };
    const testState: any = {
      members: [
        { id: "m3", name: "제킹", contribution: 0 },
      ],
      memberPositions: { m3: "실장" },
      donors: [],
      contributionLogs: [manualLog],
    };
    const repaired = syncAndRepairMemberTotals(testState);
    const jeking = repaired.members.find((m: any) => m.id === "m3");
    expect(jeking?.contribution).toBe(50000);
  });

  it("16. 퐁당퐁당 수동 기여도 가감(cl_pd_, isPongdang) 및 pongdangManualContributions는 메인 엑셀표에 일절 영향을 주지 않는다", async () => {
    const { applyOverlayDonationDisplayTotals, resolveOverlayContributionSource } = await import("@/lib/overlay-donation-aggregate");
    const { resolveMemberContributionTotal, syncAndRepairMemberTotals } = await import("@/domain/sync/sync-repair-1pass");

    // 퐁당퐁당 기여도 로그 (-31,000원 차감)
    const pongdangMinusLog: ContributionLog = {
      id: "cl_pd_1795592000_pd",
      memberId: "m_surin",
      amount: 31000,
      delta: -1,
      note: "퐁당퐁당 수동 차감",
      at: Date.now(),
      isPongdang: true,
    } as any;

    // 메인 정산표 후원 100,000원
    const mainDonor: Donor = {
      id: "d_1",
      donorName: "후원자",
      memberId: "m_surin",
      amount: 100000,
      target: "toon",
      contributionPoints: 100000,
      at: Date.now(),
    };

    const testState: any = {
      members: [
        { id: "m_surin", name: "수린", contribution: 100000, toon: 100000 },
      ],
      donors: [mainDonor],
      contributionLogs: [pongdangMinusLog],
      pongdangManualContributions: { m_surin: -31000 },
      pongdangManualMode: true,
    };

    // 1) 메인 엑셀표 오버레이 파이프라인 (isPongdangPopup: false)
    const mainOverlayState = applyOverlayDonationDisplayTotals(testState, { isPongdangPopup: false });
    const mainSurin = mainOverlayState.members.find((m: any) => m.id === "m_surin");
    expect(mainSurin?.contribution).toBe(100000); // 퐁당퐁당의 -31,000이나 pongdangManualContributions의 -31,000이 적용되지 않고 100,000 유지

    // 2) resolveOverlayContributionSource에서도 메인 표는 퐁당 로그를 필터링
    const mainSource = resolveOverlayContributionSource(testState, { isPongdangPopup: false });
    expect(mainSource.contributionLogs).toHaveLength(0); // cl_pd_ 퐁당 로그는 메인 소스에서 제외

    // 3) resolveMemberContributionTotal에서도 메인 표는 퐁당 로그를 무시
    const mainTotal = resolveMemberContributionTotal("m_surin", {
      donors: [mainDonor],
      contributionLogs: [pongdangMinusLog],
    });
    expect(mainTotal).toBe(100000); // 100,000 유지

    // 4) syncAndRepairMemberTotals 서버 동기화에서도 메인 멤버는 100,000 유지
    const repaired = syncAndRepairMemberTotals(testState);
    const repairedSurin = repaired.members.find((m: any) => m.id === "m_surin");
    expect(repairedSurin?.contribution).toBe(100000);

    // 5) 반면 퐁당퐁당 오버레이 (isPongdangPopup: true)에서는 정상적으로 퐁당 기여도 계산 적용
    const pongdangOverlayState = applyOverlayDonationDisplayTotals(testState, { isPongdangPopup: true });
    const pongdangSurin = pongdangOverlayState.members.find((m: any) => m.id === "m_surin");
    // totalManual = logVal (-31,000) + directManualVal (-31,000) = -62,000
    expect(pongdangSurin?.contribution).toBe(-62000);
  });
});
