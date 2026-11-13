import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  resolveDonationTableColumnsOptions,
  mergeDonationTablePresetFields,
} from "./donation-table-options";
import {
  resolveLivePresetStyleParam,
  presetToParams,
  resolveDay777Calc,
  resolvePongdangManualMode,
  resolveDonationAggregateFromAt,
  resolveMemberRankingMetric,
  resolveTableBgColor,
  resolveTableHeaderBgColor,
  resolveTableHeaderTextColor,
  resolveTableLineColor,
  resolveContributionColor,
  resolveTablePanelBorderColor,
  resolveTableBorderGlow,
  resolveTableBorderRadius,
  resolveTablePanelBorderWidth,
} from "./overlay-params";
import {
  resolveExcelMemberTableAccent,
  resolveTableThemeHeaderBgCss,
  resolveTableThemeTotalBorderCss,
  resolveTableThemePanelBorderCss,
  resolveTableThemeRowStripeCss,
  resolveTableThemeContributionColorCss,
  buildTableBorderGlowBoxShadow,
} from "./excel-member-table-theme";
import {
  membersWithOverlayDonationAggregate,
  resolveOverlayContributionSource,
  collectDay777SigContributionByMember,
} from "./overlay-donation-aggregate";
import {
  buildOverlayRankedMembers,
  buildMemberCreationOrderIndex,
  compareMembersByRankingMetric,
} from "./utils";
import {
  resolveExcelRankTop3RowStyle,
  resolveExcelRankTop3Style,
} from "./excel-rank-top3-style";
import type { AppState, Member, OverlayPreset } from "@/types";

describe("Pongdang overlay rendering pipeline test", () => {
  const dinState: AppState = {
    members: [
      { id: "m_1786625875510_lrkym", name: "자키", account: 147600, toon: 273700, contribution: 45600, restroom: 0, realName: "", operating: false },
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
    pongdangManualContributions: {},
    donors: [],
  };

  const pongdangPreset: Partial<OverlayPreset> = {
    id: "ov_pongdang_1",
    name: "퐁당퐁당 엑셀",
    theme: "excelPongdang",
    membersTheme: "excelPongdang",
    totalTheme: "excelPongdang",
    tableOnly: true,
    showMembers: true,
    showTotal: true,
    showCombinedColumn: true,
    showContributionColumn: true,
    showRoleColumn: false,
    showCustomColumn: true,
    showRestroomColumn: false,
    day777Calc: true,
  };

  it("tests style and param resolution for excelPongdang preset", () => {
    const rawSp = new URLSearchParams({
      p: "ov_pongdang_1",
      host: "prism",
      previewGuide: "true",
      tableOnly: "true",
    });

    const isDay777 = resolveDay777Calc(rawSp, pongdangPreset as any, { ready: true });
    expect(isDay777).toBe(true);

    const isPongdangManual = resolvePongdangManualMode(rawSp, pongdangPreset as any, { ready: true }, dinState);
    expect(isPongdangManual).toBe(false);

    const aggFromAt = resolveDonationAggregateFromAt(rawSp, pongdangPreset as any, { ready: true });
    expect(aggFromAt).toBeNull();

    const accent = resolveExcelMemberTableAccent("excelPongdang");
    expect(accent).toBeDefined();
    expect(accent?.headerBg).toBe("#064e3b");
    expect(accent?.headerBorder).toBe("#10b981");

    const headerBg = resolveTableThemeHeaderBgCss("excelPongdang");
    expect(headerBg).toBe("#064e3b");

    const glow = buildTableBorderGlowBoxShadow("#10b981", "neon");
    expect(glow).toContain("rgba(16, 185, 129");
  });

  it("tests membersWithOverlayDonationAggregate with day777Calc", () => {
    const members = membersWithOverlayDonationAggregate(
      dinState,
      dinState.members,
      null,
      { day777Calc: true, pongdangManualMode: false }
    );
    expect(members).toHaveLength(5);
    const rep = members.find((m) => m.name === "자키");
    expect(rep).toBeDefined();
    expect(rep?.contribution).toBe(45600);

    const stateWithSettlementReset: AppState = {
      ...dinState,
      settlementResetAt: 1730000000000,
    };
    const membersWithReset = membersWithOverlayDonationAggregate(
      stateWithSettlementReset,
      stateWithSettlementReset.members,
      null,
      { day777Calc: true, pongdangManualMode: false }
    );
    const repWithReset = membersWithReset.find((m) => m.name === "자키");
    expect(repWithReset?.contribution).toBe(45600);
  });

  it("tests ranking and top3 style calculation", () => {
    const members = membersWithOverlayDonationAggregate(
      dinState,
      dinState.members,
      null,
      { day777Calc: true, pongdangManualMode: false }
    );
    const orderIndex = buildMemberCreationOrderIndex(members);
    const getContribution = (m: Member) => m.contribution || 0;
    const representative = members.find((m) => m.name === "자키");
    expect(representative).toBeDefined();

    const roleMap: Record<string, string> = {};
    if (representative) roleMap[representative.id] = "대표";

    const ranked = buildOverlayRankedMembers(
      members,
      dinState.memberPositions,
      (m) => roleMap[m.id] || "",
      members,
      getContribution,
      dinState.memberRankingMetric
    );
    expect(ranked).toHaveLength(5);
  });

  it("verifies donationAggregateFromAt filters donations from specific timestamp in both standard and pongdang mode", () => {
    const t0 = 10000;
    const t1 = 20000;
    const t2 = 30000;

    const testState: AppState = {
      ...dinState,
      donors: [
        { id: "d1", memberId: "m_1786625875510_lrkym", amount: 100000, target: "account", at: t0, sigPrice: 100000 },
        { id: "d2", memberId: "m_1786625875510_lrkym", amount: 200000, target: "account", at: t1 + 1000, sigPrice: 200000 },
      ],
    };

    // 1) 전체 기간 (fromAt = null)
    // standard: fromAt = null 일 때는 원본 members 유지 (147600)
    const allStandard = membersWithOverlayDonationAggregate(testState, testState.members, null);
    expect(allStandard.find((m) => m.name === "자키")?.account).toBe(147600);

    // pongdang: day777Calc=true 시 donors의 전체 시그 기여도 합산 (100000 + 200000 = 300000)
    const allPongdang = membersWithOverlayDonationAggregate(testState, testState.members, null, { day777Calc: true });
    expect(allPongdang.find((m) => m.name === "자키")?.contribution).toBe(300000);

    // 2) t1 시점부터 (t0 후원 제외)
    const filteredStandard = membersWithOverlayDonationAggregate(testState, testState.members, t1);
    expect(filteredStandard.find((m) => m.name === "자키")?.account).toBe(200000);

    const filteredPongdang = membersWithOverlayDonationAggregate(testState, testState.members, t1, { day777Calc: true });
    expect(filteredPongdang.find((m) => m.name === "자키")?.contribution).toBe(200000);

    // 3) 미래 시점 (현재 시간부터 후원 없음)
    const futureStandard = membersWithOverlayDonationAggregate(testState, testState.members, t2);
    expect(futureStandard.find((m) => m.name === "자키")?.account).toBe(0);

    const futurePongdang = membersWithOverlayDonationAggregate(testState, testState.members, t2, { day777Calc: true });
    // 미래 시각 이후 시그가 없으므로 0원
    expect(futurePongdang.find((m) => m.name === "자키")?.contribution).toBe(0);
  });
});
