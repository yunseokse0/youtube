import { describe, it, expect } from "vitest";
import {
  collectDay777SigContributionByMember,
  applyOverlayDonationDisplayTotals,
} from "./overlay-donation-aggregate";
import { formatManThousand, formatDonorsAmount } from "@/domain/state-monolith.all";
import { memberContributionRankingTotal, buildOverlayRankedMembers } from "./utils";
import type { Donor, Member, AppState } from "@/types";

describe("Pongdang negative contribution and manual adjustment", () => {
  it("formats negative amounts with minus sign instead of clamping to 0", () => {
    // formatManThousand
    expect(formatManThousand(-50000)).toBe("-5");
    expect(formatManThousand(-100000)).toBe("-10");
    expect(formatManThousand(50000)).toBe("5");
    expect(formatManThousand(0)).toBe("0");

    // formatDonorsAmount
    expect(formatDonorsAmount(-50000, "full")).toBe("-50,000");
    expect(formatDonorsAmount(-50000, "short")).toBe("-5");
    expect(formatDonorsAmount(50000, "full")).toBe("50,000");
    expect(formatDonorsAmount(0, "full")).toBe("0");
  });

  it("applies d.pongdangMinus: true to invert donor contribution amount", () => {
    const donors: Donor[] = [
      {
        id: "d1",
        name: "후원자A",
        amount: 50000,
        sigPrice: 50000,
        memberId: "m1",
        platform: "toona",
        createdAt: "2026-11-23T12:00:00.000Z",
        isSigCredit: true,
        pongdangMinus: false,
      },
      {
        id: "d2",
        name: "후원자B",
        amount: 30000,
        sigPrice: 30000,
        memberId: "m1",
        platform: "toona",
        createdAt: "2026-11-23T12:05:00.000Z",
        isSigCredit: true,
        pongdangMinus: true, // Marked as minus
      },
    ];

    const mockState = { donors, members: [{ id: "m1", name: "자키" }] } as unknown as AppState;
    const result = collectDay777SigContributionByMember(mockState);
    // m1 contribution should be 50,000 - 30,000 = 20,000
    expect(result.get("m1")).toBe(20000);
  });

  it("allows contribution to become negative when minus donors exceed plus donors", () => {
    const donors: Donor[] = [
      {
        id: "d1",
        name: "후원자A",
        amount: 20000,
        sigPrice: 20000,
        memberId: "m1",
        platform: "toona",
        createdAt: "2026-11-23T12:00:00.000Z",
        isSigCredit: true,
        pongdangMinus: false,
      },
      {
        id: "d2",
        name: "후원자B",
        amount: 50000,
        sigPrice: 50000,
        memberId: "m1",
        platform: "toona",
        createdAt: "2026-11-23T12:05:00.000Z",
        isSigCredit: true,
        pongdangMinus: true, // -50,000
      },
    ];

    const mockState = { donors, members: [{ id: "m1", name: "자키" }] } as unknown as AppState;
    const result = collectDay777SigContributionByMember(mockState);
    // m1 contribution should be 20,000 - 50,000 = -30,000 (NOT clamped to 0!)
    expect(result.get("m1")).toBe(-30000);
  });

  it("applies manual adjustments including negative adjustments without clamping", () => {
    const members: Member[] = [
      { id: "m1", name: "자키", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "이나", account: 0, toon: 0, contribution: 0 },
    ];

    const mockState = {
      members,
      memberRankingMetric: "contribution",
      pongdangManualMode: true,
      pongdangManualContributions: {
        m1: -50000, // manual subtraction
        m2: 30000,
      },
      donors: [],
      contributionLogs: [],
    } as unknown as AppState;

    // 퐁당퐁당 팝업창 모드에서는 음수 기여도 허용
    const updated = applyOverlayDonationDisplayTotals(mockState, {
      day777Calc: true,
      isPongdangPopup: true,
    });

    const m1 = updated.members.find((m) => m.id === "m1");
    const m2 = updated.members.find((m) => m.id === "m2");

    expect(m1?.contribution).toBe(-50000);
    expect(m2?.contribution).toBe(30000);

    // 퐁당 엑셀(day777Calc=true)은 팝업 옵션 없이도 음수 보정값을 표시
    const overlayExcel = applyOverlayDonationDisplayTotals(mockState, {
      day777Calc: true,
    });
    const overlayM1 = overlayExcel.members.find((m) => m.id === "m1");
    const overlayM2 = overlayExcel.members.find((m) => m.id === "m2");
    expect(overlayM1?.contribution).toBe(-50000);
    expect(overlayM2?.contribution).toBe(30000);
  });

  it("ranks negative contributions properly below 0 in memberContributionRankingTotal", () => {
    const mPos: Member = { id: "m_pos", name: "플러스", account: 0, toon: 0, contribution: 10000 };
    const mZero: Member = { id: "m_zero", name: "제로", account: 0, toon: 0, contribution: 0 };
    const mNeg: Member = { id: "m_neg", name: "마이너스", account: 0, toon: 0, contribution: -20000 };
    const mDeepNeg: Member = { id: "m_deep_neg", name: "깊은마이너스", account: 0, toon: 0, contribution: -50000 };

    expect(memberContributionRankingTotal(mPos)).toBe(10000);
    expect(memberContributionRankingTotal(mZero)).toBe(0);
    expect(memberContributionRankingTotal(mNeg)).toBe(-20000);
    expect(memberContributionRankingTotal(mDeepNeg)).toBe(-50000);

    const members = [mDeepNeg, mZero, mPos, mNeg];
    const ranked = buildOverlayRankedMembers(members, {}, undefined, members, undefined, "contribution");

    // Ranking order should be: mPos (1st, 10000) -> mZero (2nd, 0) -> mNeg (3rd, -20000) -> mDeepNeg (4th, -50000)
    expect(ranked[0].m.id).toBe("m_pos");
    expect(ranked[1].m.id).toBe("m_zero");
    expect(ranked[2].m.id).toBe("m_neg");
    expect(ranked[3].m.id).toBe("m_deep_neg");
  });

  it("excludes memberAutoAssigned donations from pongdang contribution until manually assigned", () => {
    const donors: Donor[] = [
      {
        id: "d_auto",
        name: "불명확후원자",
        amount: 500000,
        sigPrice: 500000,
        memberId: "m1", // 임시 1위 자동 배정
        memberAutoAssigned: true, // 자동 배정 플래그
        platform: "toona",
        createdAt: "2026-11-23T12:00:00.000Z",
        isSigCredit: true,
      },
      {
        id: "d_manual",
        name: "정상후원자",
        amount: 92000,
        sigPrice: 92000,
        memberId: "m1",
        memberAutoAssigned: false,
        platform: "toona",
        createdAt: "2026-11-23T12:05:00.000Z",
        isSigCredit: true,
      },
    ];

    const mockState = { donors, members: [{ id: "m1", name: "서유하" }] } as unknown as AppState;
    const result = collectDay777SigContributionByMember(mockState);
    // d_auto(500,000)은 미지정 상태이므로 제외되고, d_manual(92,000)만 반영되어야 함!
    expect(result.get("m1")).toBe(92000);
  });

  it("does not assign unassigned manual sig sales to single member via fallback", () => {
    const mockState = {
      donors: [
        {
          id: "d1",
          name: "후원자",
          amount: 92000,
          sigPrice: 92000,
          memberId: "m1",
          platform: "toona",
          createdAt: "2026-11-23T12:05:00.000Z",
          isSigCredit: true,
        },
      ],
      members: [{ id: "m1", name: "서유하" }],
      manualSigSales: {
        selectedSigs: [
          { id: "sig1", name: "금연", price: 12100 },
          { id: "sig2", name: "디스코데기", price: 59000 },
        ],
      },
      overlaySettings: {
        sigSalesManualDraftV1: {
          sigBuyerMemberIds: [null, null], // 구매 멤버 미지정 (판매 대기 중)
        },
      },
    } as unknown as AppState;

    const result = collectDay777SigContributionByMember(mockState);
    // 판매 대기 중인 수동 시그(12,100 + 59,000)가 서유하에게 덤터기 씌워지지 않고 92,000원만 나와야 함!
    expect(result.get("m1")).toBe(92000);
  });

  it("excludes excluded members from pongdang participating members and overlay display", () => {
    const allMembers: Member[] = [
      { id: "m_zaki", name: "자키 (대표)", account: 0, toon: 0, contribution: 0 },
      { id: "m_jacking", name: "재킹 (실장)", account: 0, toon: 0, contribution: 0 },
      { id: "m_yuha", name: "서유하", account: 0, toon: 0, contribution: 92000 },
      { id: "m_jina", name: "진아", account: 0, toon: 0, contribution: 50000 },
      { id: "m_surin", name: "수린", account: 0, toon: 0, contribution: 50000 },
    ];

    const pongdangExcludedMemberIds = ["m_zaki", "m_jacking"];
    const excludedSet = new Set(pongdangExcludedMemberIds);

    const participatingMembers = allMembers.filter((m) => !excludedSet.has(m.id));

    // Participating members should only have 3 members: 서유하, 진아, 수린
    expect(participatingMembers.map((m) => m.name)).toEqual(["서유하", "진아", "수린"]);
    expect(participatingMembers.some((m) => m.id === "m_zaki")).toBe(false);
    expect(participatingMembers.some((m) => m.id === "m_jacking")).toBe(false);

    // Overlay ranking with excludedMemberIdsSet
    const ranked = buildOverlayRankedMembers(
      participatingMembers,
      {},
      undefined,
      participatingMembers,
      undefined,
      "contribution"
    );
    expect(ranked.length).toBe(3);
    expect(ranked[0].m.name).toBe("서유하");
    expect(ranked[0].m.contribution).toBe(92000);
  });
});
