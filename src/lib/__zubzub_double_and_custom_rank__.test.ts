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
});
