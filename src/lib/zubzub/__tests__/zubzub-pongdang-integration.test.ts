import { describe, it, expect } from "vitest";
import type { AppState, Donor, Member } from "@/types";
import {
  collectDay777SigContributionByMember,
  applyOverlayDonationDisplayTotals,
} from "@/lib/overlay-donation-aggregate";
import { normalizeDonorsArray } from "@/domain/state-monolith.all";
import { mergeDonorRowFields } from "@/domain/dedupe/donation-dedupe.pipeline";
import { recomputeSettlementFromDonors } from "@/lib/settlement";

describe("Zubzub & Pongdang Integration Tests", () => {
  const members: Member[] = [
    { id: "m_leader", name: "자키", account: 0, toon: 0, contribution: 0 },
    { id: "m_claim", name: "이나", account: 0, toon: 0, contribution: 0 },
    { id: "m_other", name: "진아", account: 0, toon: 0, contribution: 0 },
  ];

  const zubzubBonusDonor: Donor = {
    id: "zubzub_bonus_q123",
    name: "[대표 줍줍] 하트시그",
    donorName: "대표 시그 줍줍",
    amount: 130000,
    memberId: "m_claim",
    at: 1700000000000,
    message: "[대표 시그 줍줍] 하트시그 (+130,000점)",
    donationExcluded: true, // 실정산 현금 합산 제외!
    isSigCredit: true,
    sigPrice: 130000,
    contributionPoints: 130000,
    isZubzubBonus: true,
    zubzubQueueId: "q123",
    provider: "zubzub_bonus",
    externalId: "q123",
  };

  const baseState = {
    members,
    donors: [zubzubBonusDonor],
    memberPositions: {},
    memberPositionMode: "fixed",
    pongdangResetAt: 0,
    rouletteState: {} as any,
  } as unknown as AppState;

  it("1. collectDay777SigContributionByMember includes zubzub bonus for claiming member", () => {
    const sigMap = collectDay777SigContributionByMember(baseState);
    expect(sigMap.get("m_claim")).toBe(130000);
    expect(sigMap.get("m_leader")).toBeUndefined();
    expect(sigMap.get("m_other")).toBeUndefined();
  });

  it("2. applyOverlayDonationDisplayTotals updates member contribution with zubzub bonus when day777Calc is true", () => {
    const updated = applyOverlayDonationDisplayTotals(baseState, { day777Calc: true });
    const claimMember = updated.members.find((m) => m.id === "m_claim");
    expect(claimMember?.contribution).toBe(130000);
    // Cash totals remain 0
    expect(claimMember?.account).toBe(0);
    expect(claimMember?.toon).toBe(0);
  });

  it("3. pongdangMinus toggling negates zubzub bonus contribution", () => {
    const minusDonor: Donor = {
      ...zubzubBonusDonor,
      pongdangMinus: true,
    };
    const minusState: AppState = {
      ...baseState,
      donors: [minusDonor],
    };

    const sigMap = collectDay777SigContributionByMember(minusState);
    expect(sigMap.get("m_claim")).toBe(-130000);

    // 퐁당퐁당 팝업창 모드에서는 마이너스 기여도 적용
    const updated = applyOverlayDonationDisplayTotals(minusState, { day777Calc: true, isPongdangPopup: true });
    const claimMember = updated.members.find((m) => m.id === "m_claim");
    expect(claimMember?.contribution).toBe(-130000);

    // 퐁당퐁당엑셀의 마이너스 기여가 엑셀표(오버레이)에는 영향을 주지 않음 (정상 기여도 유지)
    const overlayExcel = applyOverlayDonationDisplayTotals(minusState, { day777Calc: true });
    const overlayClaimMember = overlayExcel.members.find((m) => m.id === "m_claim");
    expect(overlayClaimMember?.contribution).toBe(130000);
  });

  it("4. normalizeDonorsArray preserves isZubzubBonus, zubzubQueueId, and pongdangMinus", () => {
    const inputDonors = [
      {
        ...zubzubBonusDonor,
        pongdangMinus: true,
      },
    ];
    const normalized = normalizeDonorsArray(inputDonors);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].isZubzubBonus).toBe(true);
    expect(normalized[0].zubzubQueueId).toBe("q123");
    expect(normalized[0].pongdangMinus).toBe(true);
    expect(normalized[0].sigPrice).toBe(130000);
    expect(normalized[0].isSigCredit).toBe(true);
  });

  it("5. mergeDonorRowFields preserves isZubzubBonus, zubzubQueueId, and pongdangMinus", () => {
    const fallback: Donor = {
      ...zubzubBonusDonor,
    };
    const preferred: Partial<Donor> = {
      id: zubzubBonusDonor.id,
      pongdangMinus: true,
    };
    const merged = mergeDonorRowFields(preferred as Donor, fallback);
    expect(merged.isZubzubBonus).toBe(true);
    expect(merged.zubzubQueueId).toBe("q123");
    expect(merged.pongdangMinus).toBe(true);
    expect(merged.sigPrice).toBe(130000);
  });

  it("6. Real cash settlement excludes zubzub bonus from payouts", () => {
    const baseRecord = {
      id: "st_test",
      title: "정산 테스트",
      createdAt: 1700000000000,
      accountRatio: 0.7,
      toonRatio: 0.6,
      feeRate: 0.033,
      members: [
        {
          memberId: "m_claim",
          name: "이나",
          realName: "이나",
          account: 0,
          toon: 0,
          accountRatio: 0.7,
          toonRatio: 0.6,
          accountApplied: 0,
          toonApplied: 0,
          gross: 0,
          fee: 0,
          net: 0,
        },
      ],
    };

    const recomputed = recomputeSettlementFromDonors(baseRecord as unknown as any, [zubzubBonusDonor]);
    const claimMember = recomputed.members.find((m) => m.memberId === "m_claim");
    // Since donationExcluded: true, cash amounts remain 0!
    expect(claimMember?.account).toBe(0);
    expect(claimMember?.toon).toBe(0);
    expect(claimMember?.gross).toBe(0);
    expect(claimMember?.net).toBe(0);
  });
});
