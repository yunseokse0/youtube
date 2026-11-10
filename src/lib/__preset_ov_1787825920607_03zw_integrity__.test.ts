import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  membersWithOverlayDonationAggregate,
  resolveOverlayContributionSource,
} from "./overlay-donation-aggregate";
import {
  buildOverlayRankedMembers,
  buildMemberCreationOrderIndex,
  compareMembersByRankingMetric,
} from "./utils";
import {
  resolveExcelMemberTableAccent,
  isExcelGoldTableTheme,
} from "./excel-member-table-theme";
import {
  resolveExcelRankTop3RowStyle,
  resolveExcelRankTop3Style,
} from "./excel-rank-top3-style";
import type { AppState, Member } from "@/types";

describe("Preset ov_1787825920607_03zw & user din overlay runtime verification", () => {
  const dinState: AppState = {
    members: [
      { id: "m_1786625875510_lrkym", name: "자키", account: 147600, toon: 273700, contribution: 42130, restroom: 0, realName: "", operating: false },
      { id: "m_1788509337974_qi1mf", name: "열음", account: 0, toon: 17200, contribution: 1720, restroom: 0, realName: "", operating: false },
      { id: "m_1788514902308_4en73", name: "수린", account: 0, toon: 0, contribution: 0, restroom: 0, realName: "", operating: false },
      { id: "m_1788514906147_ksf2p", name: "초화", account: 0, toon: 100, contribution: 10, restroom: 0, realName: "", operating: false },
      { id: "m_1788514910671_plggw", name: "영실", account: 0, toon: 100, contribution: 10, restroom: 0, realName: "", operating: false },
    ],
    memberPositions: { "m_1786625875510_lrkym": "대표" },
    memberPositionMode: "rankLinked",
    memberRankingMetric: "contribution",
    rankPositionLabels: ["대표", "", "", "", ""],
    pongdangManualMode: false,
    pongdangManualContributions: {
      "m_1786625875510_lrkym": 0,
      "m_1788509337974_qi1mf": 0,
      "m_1788514902308_4en73": 0,
      "m_1788514906147_ksf2p": 0,
      "m_1788514910671_plggw": 0,
    },
    donors: [],
  };

  const preset = {
    id: "ov_1787825920607_03zw",
    name: "웹후원 골드 엑셀",
    scale: "1.1",
    memberSize: "24",
    totalSize: "56",
    dense: true,
    anchor: "cc",
    layout: "center-fixed",
    zoomMode: "follow",
    tableFree: true,
    tableX: "50",
    tableY: "50",
    theme: "excelGold",
    membersTheme: "excelGold",
    totalTheme: "excelGold",
    tableOnly: true,
    showMembers: true,
    showTotal: false,
    showCombinedColumn: true,
    showContributionColumn: false,
    showRestroomColumn: false,
    showCustomColumn: false,
    showTableSumRow: false,
    accountHeaderLabel: "계좌",
    toonHeaderLabel: "투네",
    rankTop3Mode: "text" as const,
    rank1Effect: "colorShift" as const,
    rank2Effect: "colorShift" as const,
    rank1TextColor: "#ffffff",
    rank1TextColorAlt: "#d506fe",
    tableHeaderTextOutlineColor: "#000000",
    tableHeaderTextOutlineWidth: "3",
    tableHeaderBgColor: "#ffd970",
    tableHeaderTextColor: "#ffffff",
  };

  it("calculates contribution source without crashing", () => {
    const src = resolveOverlayContributionSource(dinState, {
      fromAt: null,
      day777Calc: false,
      pongdangManualMode: false,
    });
    expect(src).toBeDefined();
  });

  it("calculates membersWithOverlayDonationAggregate without crashing", () => {
    const members = membersWithOverlayDonationAggregate(
      dinState,
      dinState.members,
      null,
      { day777Calc: false, pongdangManualMode: false }
    );
    expect(members).toHaveLength(5);
  });

  it("calculates rankLinked roles and ranking order (representative rank is null, others 1..n)", () => {
    const orderIndex = buildMemberCreationOrderIndex(dinState.members);
    const getContributionValueForMember = (m: Member) => m.contribution || 0;

    const roleMap: Record<string, string> = {};
    const representative = dinState.members.find((m) => {
      const pos = (dinState.memberPositions[m.id] || "").trim();
      return pos.includes("대표");
    });
    expect(representative?.name).toBe("자키");

    const others = dinState.members
      .filter((m) => !representative || m.id !== representative.id)
      .sort((a, b) =>
        compareMembersByRankingMetric(
          a,
          b,
          dinState.memberRankingMetric,
          orderIndex,
          getContributionValueForMember
        )
      );

    if (representative) roleMap[representative.id] = "대표";
    const startIdx = representative ? 1 : 0;
    others.forEach((m, idx) => {
      const rankIdx = idx + startIdx;
      const label = String(dinState.rankPositionLabels[rankIdx] || "").trim() || (rankIdx === 0 ? "대표" : "");
      if (label) roleMap[m.id] = label;
    });

    expect(roleMap[representative!.id]).toBe("대표");

    const ranked = buildOverlayRankedMembers(
      dinState.members,
      dinState.memberPositions,
      (m) => roleMap[m.id] || "",
      dinState.members,
      getContributionValueForMember,
      dinState.memberRankingMetric
    );

    expect(ranked).toHaveLength(5);
    // Representative rank is null (rendered as "대표" badge in overlay)
    expect(ranked[0].m.name).toBe("자키");
    expect(ranked[0].rank).toBeNull();
    // Subsequent members get rank 1, 2, ...
    expect(ranked[1].m.name).toBe("열음");
    expect(ranked[1].rank).toBe(1);
  });

  it("verifies excelGold table styling with SearchParams", () => {
    expect(isExcelGoldTableTheme("excelGold")).toBe(true);
    const accent = resolveExcelMemberTableAccent("excelGold");
    expect(accent).toBeDefined();

    const mockSp = new URLSearchParams({
      p: "ov_1787825920607_03zw",
      u: "din",
      host: "prism",
    });

    const top3Style = resolveExcelRankTop3Style(mockSp, preset as any, { ready: true });
    const top3_1 = resolveExcelRankTop3RowStyle(1, top3Style, { donationTotal: 421300 });
    expect(top3_1).toBeDefined();

    const top3_2 = resolveExcelRankTop3RowStyle(2, top3Style, { donationTotal: 17200 });
    expect(top3_2).toBeDefined();

    const top3_3 = resolveExcelRankTop3RowStyle(3, top3Style, { donationTotal: 100 });
    expect(top3_3).toBeDefined();

    const top3_4 = resolveExcelRankTop3RowStyle(4, top3Style, { donationTotal: 100 });
    expect(top3_4).toBeDefined();
  });
});
