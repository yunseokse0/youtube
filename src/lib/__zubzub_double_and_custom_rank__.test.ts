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

  it("1. createZubzubBonusContributionLog는 2배 배율일 때 1배 보너스(50,000)를 생성하여 본인 후원(50,000)과 함께 총 2배(100,000)가 되게 한다", () => {
    const log = createZubzubBonusContributionLog("q_1", "m_jina", 50000, "NO BATIDÃO", Date.now(), {
      doubleContribution: true,
      baseSigPrice: 50000,
      multiplier: 2,
    });
    expect(log.amount).toBe(50000);
    expect(log.baseSigPrice).toBe(50000);
    expect(log.multiplier).toBe(2);
    expect(log.note).toContain("50,000점 [2배 적용]");
  });

  it("2. createZubzubBonusContributionLog는 doubleContribution=false (1배)일 때 0원 보너스를 생성한다", () => {
    const log = createZubzubBonusContributionLog("q_2", "m_jina", 0, "NO BATIDÃO", Date.now(), {
      doubleContribution: false,
      baseSigPrice: 50000,
      multiplier: 1,
    });
    expect(log.amount).toBe(0);
    expect(log.baseSigPrice).toBe(50000);
    expect(log.multiplier).toBe(1);
    expect(log.note).not.toContain("[2배 적용]");
  });

  it("3. 일반 엑셀표(syncMemberTotalsFromDonors)는 본인 후원(50,000) + 줍줍 보너스(50,000)로 정확히 2배(100,000)를 반영한다 (3배 튀지 않음)", () => {
    const log = createZubzubBonusContributionLog("q_1", "m_jina", 50000, "NO BATIDÃO", Date.now(), {
      doubleContribution: true,
      baseSigPrice: 50000,
      multiplier: 2,
    });
    const state: AppState = {
      members,
      donors: [
        {
          id: "d_jina_sig",
          amount: 50000,
          memberId: "m_jina",
          target: "account",
          contributionPoints: 50000,
        } as any,
      ],
      contributionLogs: [log],
    } as any;
    const synced = syncMemberTotalsFromDonors(state);
    const jina = synced.members.find((m) => m.id === "m_jina");
    // 본인 후원 50,000 + 줍줍 보너스 50,000 = 정확히 100,000원 (2배!)
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

  it("17. 단순 텍스트 후원(멤버명 또는 일반 메시지)은 줍줍 대상에서 제외되어 대기열 등록/획득이 되지 않는다", async () => {
    const { isEligibleSigDonation, processZubzubDonationHook } = await import("@/lib/zubzub/zubzub-engine");
    const { resetInMemoryZubZubQueueForTests, getInMemoryZubZubQueueForTests } = await import("@/lib/zubzub/zubzub-repo");
    resetInMemoryZubZubQueueForTests();

    const testState: any = {
      members: [
        { id: "m_jaki", name: "자키", contribution: 0 },
        { id: "m_ina", name: "이나", contribution: 0 },
      ],
      memberPositions: { m_jaki: "대표", m_ina: "대리" },
      sigInventory: [
        { id: "sig_alive", name: "ALIVE", price: 52000 },
      ],
      zubzubSettings: {
        enabled: true,
        minSigPrice: 50000,
        representativeMemberId: "m_jaki",
      },
      donors: [],
    };

    // 1) 대표에게 52,000원 후원 유입 - 메시지가 단순 텍스트 '자키' 또는 '대표자키'인 경우
    const textEventRep = {
      id: "evt_rep_text",
      amount: 52000,
      memberId: "m_jaki",
      message: "자키",
      matchedSigName: "ALIVE", // enrichDonationEventWithSigMatch에서 금액으로 자동 매칭된 경우
      isAutoMatched: true,
    } as any;

    const repSigCheck = isEligibleSigDonation(textEventRep, testState, 50000);
    expect(repSigCheck.isSig).toBe(false);

    const repHookRes = await processZubzubDonationHook("zakiexcel", textEventRep, testState);
    expect(repHookRes.action).toBe("skipped");
    expect(getInMemoryZubZubQueueForTests("zakiexcel")).toHaveLength(0); // 큐에 등록되지 않음!

    // 2) 멤버에게 52,000원 후원 유입 - 메시지가 단순 텍스트 '이나'인 경우
    const textEventIna = {
      id: "evt_ina_text",
      amount: 52000,
      memberId: "m_ina",
      message: "이나",
      matchedSigName: "ALIVE",
      isAutoMatched: true,
    } as any;

    const inaSigCheck = isEligibleSigDonation(textEventIna, testState, 50000);
    expect(inaSigCheck.isSig).toBe(false);

    const inaHookRes = await processZubzubDonationHook("zakiexcel", textEventIna, testState);
    expect(inaHookRes.action).toBe("skipped");
  });

  it("18. 메시지에 실제 시그명이 포함된 후원 또는 룰렛 시그 당첨은 줍줍으로 정상 처리된다", async () => {
    const { isEligibleSigDonation, processZubzubDonationHook } = await import("@/lib/zubzub/zubzub-engine");
    const { resetInMemoryZubZubQueueForTests, getInMemoryZubZubQueueForTests } = await import("@/lib/zubzub/zubzub-repo");
    resetInMemoryZubZubQueueForTests();

    const testState: any = {
      members: [
        { id: "m_jaki", name: "자키", contribution: 0 },
        { id: "m_ina", name: "이나", contribution: 0 },
      ],
      memberPositions: { m_jaki: "대표", m_ina: "대리" },
      sigInventory: [
        { id: "sig_alive", name: "ALIVE", price: 52000 },
      ],
      zubzubSettings: {
        enabled: true,
        minSigPrice: 50000,
        representativeMemberId: "m_jaki",
        doubleContribution: true,
      },
      donors: [],
    };

    // 1) 대표에게 메시지에 시그명이 들어간 후원 발생 -> 줍줍 큐 적재
    const realSigEventRep = {
      id: "evt_rep_sig",
      amount: 52000,
      memberId: "m_jaki",
      message: "자키 대표님 ALIVE",
      matchedSigName: "ALIVE",
    } as any;

    const repSigCheck = isEligibleSigDonation(realSigEventRep, testState, 50000);
    expect(repSigCheck.isSig).toBe(true);
    expect(repSigCheck.sigName).toBe("ALIVE");

    const repHookRes = await processZubzubDonationHook("zakiexcel", realSigEventRep, testState);
    expect(repHookRes.action).toBe("enqueued_waiting");
    expect(getInMemoryZubZubQueueForTests("zakiexcel")).toHaveLength(1);

    // 2) 일반 멤버에게 메시지에 시그명이 들어간 후원 발생 -> 줍줍 획득 (CLAIMED)
    const realSigEventIna = {
      id: "evt_ina_sig",
      amount: 52000,
      memberId: "m_ina",
      message: "이나 ALIVE 부탁드려요",
      matchedSigName: "ALIVE",
    } as any;

    const inaSigCheck = isEligibleSigDonation(realSigEventIna, testState, 50000);
    expect(inaSigCheck.isSig).toBe(true);

    const inaHookRes = await processZubzubDonationHook("zakiexcel", realSigEventIna, testState);
    expect(inaHookRes.action).toBe("claimed");
    if (inaHookRes.action === "claimed") {
      // 본인 후원 52000원에 대해 1배 추가 보너스(+52000)를 지급하여 총 104,000점 (정확히 2배!)
      expect(inaHookRes.bonusDonor.contributionPoints).toBe(52000);
      expect(inaHookRes.contributionLog.amount).toBe(52000);
    }
  });

  it("19. 메인 수동 기여도 추가는 퐁당퐁당 기여도에 절대 합산되지 않고 완전히 분리된다", async () => {
    const { collectDay777SigContributionByMember } = await import("@/lib/overlay-donation-aggregate");
    const { syncAndRepairMemberTotals } = await import("@/domain/sync/sync-repair-1pass");

    // 메인 수동 기여도 로그 (+50,000원 추가)
    const mainManualLog: ContributionLog = {
      id: "cl_main_1795590003000",
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
      contributionLogs: [mainManualLog],
    };

    // 1) 메인 엑셀표 수동 기여도는 메인 표에 정상 반영 (+50,000원)
    const repaired = syncAndRepairMemberTotals(testState);
    const jeking = repaired.members.find((m: any) => m.id === "m3");
    expect(jeking?.contribution).toBe(50000);

    // 2) 그러나 퐁당퐁당(777데이) 기여도에는 일절 합산되지 않음 (0점 또는 undefined)
    const pongdangMap = collectDay777SigContributionByMember(testState);
    expect(pongdangMap.get("m3")).toBeUndefined();
  });

  it("20. 기여도 로그 삭제 시 deletedContributionLogIds에 기록되어 merge/autosave 시에도 다시 부활하지 않는다", async () => {
    const { mergePartialState } = await import("@/shell/state/state-save-shared");
    const { mergeDonationApplyBase } = await import("@/domain/merge/apply-6branches.all");

    const manualLog1: ContributionLog = {
      id: "cl_1",
      memberId: "m_jaki",
      amount: 50000,
      delta: 1,
      note: "수동 1",
      at: 1000,
    };
    const manualLog2: ContributionLog = {
      id: "cl_2",
      memberId: "m_ina",
      amount: 30000,
      delta: 1,
      note: "수동 2",
      at: 2000,
    };

    const baseState: any = {
      members: [
        { id: "m_jaki", name: "자키", contribution: 50000 },
        { id: "m_ina", name: "이나", contribution: 30000 },
      ],
      contributionLogs: [manualLog1, manualLog2],
    };

    // 1) 유저가 cl_2를 삭제함 -> contributionLogs에서 cl_2 제거, deletedContributionLogIds에 cl_2 추가
    const patchState: any = {
      contributionLogs: [manualLog1],
      deletedContributionLogIds: ["cl_2"],
    };

    const merged = mergePartialState(baseState, patchState, "zakiexcel");
    // cl_2가 부활하지 않고 cl_1만 유지됨!
    expect(merged.contributionLogs).toHaveLength(1);
    expect(merged.contributionLogs?.[0].id).toBe("cl_1");
    expect(merged.deletedContributionLogIds).toContain("cl_2");

    // 2) apply-6branches mergeDonationApplyBase 에서도 부활하지 않음
    const baseWithDeleted: any = {
      ...baseState,
      contributionLogs: [manualLog1],
      deletedContributionLogIds: ["cl_2"],
    };
    const incomingHint: any = {
      ...baseState,
      contributionLogs: [manualLog1, manualLog2], // 예전 서버 스냅샷
    };
    const branchedMerged = mergeDonationApplyBase(baseWithDeleted, incomingHint);
    expect(branchedMerged.contributionLogs).toHaveLength(1);
    expect(branchedMerged.contributionLogs?.[0].id).toBe("cl_1");
  });

  it("21. applyOverlayDonationDisplayTotals는 메인 수동 기여도를 퐁당퐁당(day777/popup) 기여도에 절대 포함하지 않는다", async () => {
    const { applyOverlayDonationDisplayTotals } = await import("@/lib/overlay-donation-aggregate");

    const stateWithMainManual: any = {
      members: [
        { id: "m_surin", name: "수린", contribution: 100000 },
        { id: "m_jeking", name: "제킹", contribution: 50000 },
      ],
      donors: [],
      contributionLogs: [
        // 메인 수동 기여도: 제킹 50,000원
        {
          id: "cl_main_123",
          memberId: "m_jeking",
          amount: 50000,
          delta: 1,
          note: "메인 수동 추가",
          at: 1000,
        },
        // 퐁당퐁당 수동 기여도: 수린 30,000원
        {
          id: "cl_pd_456",
          memberId: "m_surin",
          amount: 30000,
          delta: 1,
          note: "퐁당 수동 추가",
          at: 2000,
          isPongdang: true,
        },
      ],
      pongdangManualContributions: {},
      pongdangManualMode: true,
    };

    // 1) 퐁당퐁당 엑셀표 오버레이 (day777Calc: true)
    const overlayRes = applyOverlayDonationDisplayTotals(stateWithMainManual, { day777Calc: true });
    const jekingOverlay = overlayRes.members.find((m) => m.id === "m_jeking");
    const surinOverlay = overlayRes.members.find((m) => m.id === "m_surin");
    expect(jekingOverlay?.contribution).toBe(0); // 메인 수동 기여도가 퐁당퐁당에 전혀 합산되지 않음!
    expect(surinOverlay?.contribution).toBe(30000); // 퐁당퐁당 수동 기여도만 정상 반영!

    // 2) 퐁당퐁당 팝업창 모드 (isPongdangPopup: true)
    const popupRes = applyOverlayDonationDisplayTotals(stateWithMainManual, { isPongdangPopup: true });
    const jekingPopup = popupRes.members.find((m) => m.id === "m_jeking");
    const surinPopup = popupRes.members.find((m) => m.id === "m_surin");
    expect(jekingPopup?.contribution).toBe(0);
    expect(surinPopup?.contribution).toBe(30000);
  });

  it("22. 마지막 남은 수동 기여도를 삭제하여 contributionLogs가 빈 배열([])이 되어도 부활하지 않는다", async () => {
    const { mergePartialState } = await import("@/shell/state/state-save-shared");
    const { mergeDonationApplyBase } = await import("@/domain/merge/apply-6branches.all");

    const manualLog: ContributionLog = {
      id: "cl_pd_single",
      memberId: "m_surin",
      amount: 31000,
      delta: -1,
      note: "수동 기여도 차감",
      at: 1000,
      isPongdang: true,
    };

    const baseState: any = {
      members: [{ id: "m_surin", name: "수린", contribution: -31000 }],
      contributionLogs: [manualLog],
    };

    // 유저가 마지막 남은 1건을 삭제함 -> patch.contributionLogs = []
    const patchState: any = {
      contributionLogs: [],
      deletedContributionLogIds: ["cl_pd_single"],
    };

    const merged = mergePartialState(baseState, patchState, "zakiexcel");
    expect(merged.contributionLogs).toEqual([]); // 빈 배열 유지! 부활 없음!

    const branchedMerged = mergeDonationApplyBase(
      { ...baseState, contributionLogs: [], deletedContributionLogIds: ["cl_pd_single"] },
      baseState
    );
    expect(branchedMerged.contributionLogs).toEqual([]); // 빈 배열 유지!
  });

  it("23. 수동 로그 삭제 시 deletedContributionLogIds가 제공되면 hint/base에서 수동 로그를 절대 부활시키지 않고 서버 줍줍 보너스만 보존한다", async () => {
    const { mergeDonationApplyBase } = await import("@/domain/merge/apply-6branches.all");
    const { mergePartialState } = await import("@/shell/state/state-save-shared");

    const manualLog: ContributionLog = {
      id: "cl_pd_manual",
      memberId: "m_surin",
      amount: 50000,
      delta: 1,
      note: "수동 로그",
      at: 1000,
      isPongdang: true,
    };
    const zubzubLog: ContributionLog = {
      id: "zubzub_bonus_1",
      memberId: "m_jaki",
      amount: 52000,
      delta: 1,
      at: 2000,
      isZubzubBonus: true,
    };

    const serverHint: any = {
      members: [{ id: "m_surin", name: "수린" }],
      contributionLogs: [manualLog, zubzubLog],
    };

    // 클라이언트가 manualLog를 삭제하고 서버 보너스는 아직 모르는 상태:
    const clientFresh: any = {
      members: [{ id: "m_surin", name: "수린" }],
      contributionLogs: [], // 클라이언트가 수동 로그를 삭제함
      deletedContributionLogIds: ["cl_pd_manual"],
    };

    // 1) mergeDonationApplyBase: 삭제된 수동 로그는 부활하지 않고, 오직 서버 Zubzub 보너스만 합산됨!
    const branchedMerged = mergeDonationApplyBase(clientFresh, serverHint);
    expect(branchedMerged.contributionLogs).toHaveLength(1);
    expect(branchedMerged.contributionLogs?.[0].id).toBe("zubzub_bonus_1");

    // 2) mergePartialState: 수동 로그 부활 차단, Zubzub 보너스만 보존
    const partialMerged = mergePartialState(serverHint, clientFresh, "zakiexcel");
    expect(partialMerged.contributionLogs).toHaveLength(1);
    expect(partialMerged.contributionLogs?.[0].id).toBe("zubzub_bonus_1");
  });

  it("24. 퐁당퐁당 엑셀표에서 이전 리셋 시각보다 더 과거 시간을 선택했을 때 기존 후원을 정상적으로 불러온다", async () => {
    const { applyOverlayDonationDisplayTotals } = await import("@/lib/overlay-donation-aggregate");

    // 후원 3건: 10:00 (5만), 12:00 (3만), 14:00 (4만)
    const t10 = 10000;
    const t12 = 12000;
    const t14 = 14000;
    const baseState: any = {
      members: [{ id: "m_surin", name: "수린", contribution: 0 }],
      donors: [
        { id: "d1", name: "팬1", memberId: "m_surin", amount: 777000, at: t10, target: "account", sigPrice: 50000, isSigCredit: true },
        { id: "d2", name: "팬2", memberId: "m_surin", amount: 777000, at: t12, target: "account", sigPrice: 30000, isSigCredit: true },
        { id: "d3", name: "팬3", memberId: "m_surin", amount: 777000, at: t14, target: "account", sigPrice: 40000, isSigCredit: true },
      ],
      pongdangResetAt: 13000, // 이전에 13:00에 0원 초기화 실행됨
    };

    // 1) 이전 리셋 시점(13:00) 기준으로는 14:00의 40,000원 1건만 집계됨
    const initialRes = applyOverlayDonationDisplayTotals(baseState, { day777Calc: true });
    expect(initialRes.members.find((m: any) => m.id === "m_surin")?.contribution).toBe(40000);

    // 2) 사용자가 과거 시간 11:00 (t=11000)을 선택:
    // 이전 리셋 시각(13000)에 클램핑되지 않고 11:00 이후 후원인 12:00(3만) + 14:00(4만) = 70,000원을 성공적으로 불러와야 함!
    const pastTimeRes = applyOverlayDonationDisplayTotals(
      { ...baseState, pongdangResetAt: 11000 },
      { day777Calc: true, fromAt: 11000 }
    );
    expect(pastTimeRes.members.find((m: any) => m.id === "m_surin")?.contribution).toBe(70000);

    // 3) 프리셋에서만 fromAt을 과거 시각 11000으로 넘겼을 때도 동일하게 70,000원 반영
    const presetPastRes = applyOverlayDonationDisplayTotals(baseState, { day777Calc: true, fromAt: 11000 });
    expect(presetPastRes.members.find((m: any) => m.id === "m_surin")?.contribution).toBe(70000);
  });

  it("25. 퐁당퐁당 엑셀표에서 과거 시간 선택 시 메인 정산 settlementResetAt에 차단되지 않고 기존 후원을 온전히 불러온다", async () => {
    const { applyOverlayDonationDisplayTotals } = await import("@/lib/overlay-donation-aggregate");

    const t10 = 10000;
    const t12 = 12000;
    const t14 = 14000;
    const baseState: any = {
      members: [{ id: "m_ina", name: "이나", contribution: 0 }],
      donors: [
        { id: "d1", name: "팬1", memberId: "m_ina", amount: 777000, at: t10, target: "account", sigPrice: 52000, isSigCredit: true },
        { id: "d2", name: "팬2", memberId: "m_ina", amount: 777000, at: t12, target: "account", sigPrice: 31000, isSigCredit: true },
        { id: "d3", name: "팬3", memberId: "m_ina", amount: 777000, at: t14, target: "account", sigPrice: 52000, isSigCredit: true },
      ],
      settlementResetAt: 15000, // 메인 정산은 15:00에 리셋됨
      intentionalDonationClearAt: 15000,
      pongdangResetAt: 11000, // 사용자가 퐁당퐁당을 11:00부터 책정하도록 지정
    };

    // 메인 정산 리셋(15:00)에 차단되지 않고 11:00 이후 후원인 12:00(31,000) + 14:00(52,000) = 83,000원이 정상 집계됨
    const res = applyOverlayDonationDisplayTotals(baseState, { day777Calc: true, fromAt: 11000 });
    expect(res.members.find((m: any) => m.id === "m_ina")?.contribution).toBe(83000);
  });

  it("26. 퐁당퐁당 엑셀표에서 전체 기간(pongdangResetAt = 0) 선택 시 모든 과거 후원을 온전히 원복한다", async () => {
    const { applyOverlayDonationDisplayTotals } = await import("@/lib/overlay-donation-aggregate");

    const baseState: any = {
      members: [{ id: "m_ina", name: "이나", contribution: 0 }],
      donors: [
        { id: "d1", name: "팬1", memberId: "m_ina", amount: 777000, at: 1000, target: "account", sigPrice: 52000, isSigCredit: true },
        { id: "d2", name: "팬2", memberId: "m_ina", amount: 777000, at: 2000, target: "account", sigPrice: 31000, isSigCredit: true },
        { id: "d3", name: "팬3", memberId: "m_ina", amount: 777000, at: 3000, target: "account", sigPrice: 52000, isSigCredit: true },
      ],
      settlementResetAt: 5000, // 메인 방송 리셋
      pongdangResetAt: 0, // 전체 기간 선택
    };

    const res = applyOverlayDonationDisplayTotals(baseState, { day777Calc: true, fromAt: null });
    // 전체 3건 (52000 + 31000 + 52000 = 135000원) 모두 복원
    expect(res.members.find((m: any) => m.id === "m_ina")?.contribution).toBe(135000);
  });

  it("27. 줍줍 배율 조절(1배, 2배, 3배, 5배) 시 총 기여도가 정확히 배율만큼 계산되고 3배로 튀지 않는다", async () => {
    const { processZubzubDonationHook } = await import("@/lib/zubzub/zubzub-engine");
    const { syncMemberTotalsFromDonors } = await import("@/domain/sync/sync-repair-1pass");

    // 대표 시그 50,000원 적재
    const repEvent = {
      id: "evt_rep_mult",
      amount: 50000,
      memberId: "m_rep",
      message: "대표 ALIVE 시그",
      matchedSigName: "ALIVE",
    } as any;
    const repState: any = {
      members,
      zubzubSettings: { enabled: true, minSigPrice: 50000, representativeMemberId: "m_rep", multiplier: 3 },
      donors: [],
      contributionLogs: [],
    };
    await processZubzubDonationHook("test_user_mult", repEvent, repState);

    // 진아가 50,000원 시그 후원을 받아 3배 줍줍 성공
    const jinaEvent = {
      id: "evt_jina_mult",
      amount: 50000,
      memberId: "m_jina",
      message: "진아 ALIVE 시그",
      matchedSigName: "ALIVE",
    } as any;
    const claimState: any = {
      ...repState,
      donors: [
        { id: "evt_jina_mult", memberId: "m_jina", amount: 50000, target: "account", contributionPoints: 50000, at: Date.now() },
      ],
    };
    const claimRes = await processZubzubDonationHook("test_user_mult", jinaEvent, claimState);
    expect(claimRes.action).toBe("claimed");
    if (claimRes.action === "claimed") {
      // 3배 설정 시: 본인 후원(50,000) + 줍줍 보너스(100,000, 2배) = 총 150,000 (정확히 3배!)
      expect(claimRes.bonusDonor.contributionPoints).toBe(100000);
      expect(claimRes.contributionLog.amount).toBe(100000);
      expect(claimRes.contributionLog.multiplier).toBe(3);

      const synced = syncMemberTotalsFromDonors({
        ...claimState,
        contributionLogs: [claimRes.contributionLog],
      });
      expect(synced.members.find((m: any) => m.id === "m_jina")?.contribution).toBe(150000);
    }
  });

  it("28. 퐁당퐁당 기여도에 줍줍 보너스가 배율과 함께 정상 반영되며, 멤버명으로 기록된 로그도 정상 매칭된다", async () => {
    const { collectDay777SigContributionByMember, applyOverlayDonationDisplayTotals } = await import("@/lib/overlay-donation-aggregate");
    const { collectPongdangPopupAutoContributionByMember } = await import("@/lib/pongdang-popup-contribution");

    const jinaLog: ContributionLog = {
      id: "zubzub_bonus_q_kor",
      memberId: "진아", // 멤버 ID가 아닌 한글 멤버명으로 저장된 경우
      amount: 50000, // 2배 배율의 보너스 (+50,000)
      baseSigPrice: 50000,
      multiplier: 2,
      delta: 1,
      isZubzubBonus: true,
      at: Date.now(),
    };

    const testState: any = {
      members: [
        { id: "m_jina", name: "진아", contribution: 0 },
        { id: "m_surin", name: "수린", contribution: 0 },
      ],
      donors: [
        {
          id: "d_jina_sig",
          memberId: "진아", // 한글 이름
          amount: 50000,
          sigPrice: 50000,
          isSigCredit: true,
          at: Date.now(),
        },
      ],
      contributionLogs: [jinaLog],
      zubzubSettings: {
        enabled: true,
        multiplier: 2,
        applyContributionToPongdang: true,
        applyDoubleContributionToPongdang: true,
      },
    };

    // 1) 퐁당퐁당 오버레이 집계
    const overlayMap = collectDay777SigContributionByMember(testState, null);
    // 본인 시그 50,000 + 줍줍 보너스 50,000 = 총 100,000원!
    expect(overlayMap.get("m_jina")).toBe(100000);

    // 2) 퐁당퐁당 팝업 집계
    const popupMap = collectPongdangPopupAutoContributionByMember(testState);
    expect(popupMap.get("m_jina")).toBe(100000);

    // 3) applyOverlayDonationDisplayTotals 전체 오버레이 반영
    const applied = applyOverlayDonationDisplayTotals(testState, { day777Calc: true });
    expect(applied.members.find((m: any) => m.id === "m_jina")?.contribution).toBe(100000);
  });
});
