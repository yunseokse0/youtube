import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  membersWithOverlayDonationAggregate,
  applyOverlayDonationDisplayTotals,
  collectDay777SigContributionByMember,
  normalizeDonationAggregateFromAt,
  filterDonorsFromAggregateAt,
} from "./overlay-donation-aggregate";
import {
  buildOverlayRankedMembers,
  buildMemberCreationOrderIndex,
} from "./utils";
import {
  resolveDonationTableColumnsOptions,
  mergeDonationTablePresetFields,
} from "./donation-table-options";
import {
  resolveDay777Calc,
  resolvePongdangManualMode,
  resolveDonationAggregateFromAt,
} from "./overlay-params";
import {
  getRoundContributionSnapshot,
  applyRoundContributionToState,
} from "./settlement-contribution-restore";
import type { AppState, Member, Donor, OverlayPreset, SettlementRecord } from "@/types";

describe("System Bug Check Suite - Overlay, Pongdang, Settlement & Aggregate Window", () => {
  const baseMembers: Member[] = [
    { id: "m_jaki", name: "자키", role: "대표", account: 150000, toon: 250000, contribution: 45600, restroom: 0, realName: "", operating: false },
    { id: "m_yeoreum", name: "열음", role: "", account: 10000, toon: 20000, contribution: 1720, restroom: 0, realName: "", operating: false },
    { id: "m_chohwa", name: "초화", role: "", account: 0, toon: 1000, contribution: 100, restroom: 0, realName: "", operating: false },
    { id: "m_surin", name: "수린", role: "", account: 0, toon: 0, contribution: 0, restroom: 0, realName: "", operating: false },
  ];

  const baseDonors: Donor[] = [
    { id: "d1", memberId: "m_jaki", amount: 100000, target: "account", at: 1000, sigPrice: 100000 },
    { id: "d2", memberId: "m_jaki", amount: 777000, target: "account", at: 2000 }, // 777 shot (계좌에는 남고 기여도에선 제외)
    { id: "d3", memberId: "m_yeoreum", amount: 50000, target: "toon", at: 3000, sigPrice: 50000 },
    { id: "d4", memberId: "m_jaki", amount: 150000, target: "account", at: 5000, sigPrice: 150000 },
  ];

  const testState: AppState = {
    members: baseMembers,
    donors: baseDonors,
    contributionLogs: [],
    memberPositions: { "m_jaki": "대표" },
    memberPositionMode: "rankLinked",
    memberRankingMetric: "contribution",
    rankPositionLabels: ["대표", "", "", ""],
    pongdangManualMode: false,
    pongdangManualContributions: {},
  };

  describe("1. donationAggregateFromAt (후원 집계 기준 시점) Bug Check", () => {
    it("handles null, empty string, and undefined as '전체 기간'", () => {
      expect(normalizeDonationAggregateFromAt(null)).toBeNull();
      expect(normalizeDonationAggregateFromAt("")).toBeNull();
      expect(normalizeDonationAggregateFromAt(undefined)).toBeNull();
      expect(normalizeDonationAggregateFromAt(0)).toBeNull();
      expect(normalizeDonationAggregateFromAt("0")).toBeNull();
      expect(normalizeDonationAggregateFromAt("-100")).toBeNull();
    });

    it("parses valid timestamps correctly", () => {
      expect(normalizeDonationAggregateFromAt("1700000000000")).toBe(1700000000000);
      expect(normalizeDonationAggregateFromAt(1700000000000)).toBe(1700000000000);
    });

    it("filters donors correctly based on fromAt cutoff", () => {
      const all = filterDonorsFromAggregateAt(baseDonors, 0);
      expect(all).toHaveLength(4);

      const after2500 = filterDonorsFromAggregateAt(baseDonors, 2500);
      expect(after2500).toHaveLength(2);
      expect(after2500.map((d) => d.id)).toEqual(["d3", "d4"]);

      const after6000 = filterDonorsFromAggregateAt(baseDonors, 6000);
      expect(after6000).toHaveLength(0);
    });

    it("applies time filter to standard excel overlay without modifying original state", () => {
      const fromAt = 2500;
      const filtered = membersWithOverlayDonationAggregate(testState, testState.members, fromAt);
      
      const jaki = filtered.find((m) => m.name === "자키");
      const yeoreum = filtered.find((m) => m.name === "열음");

      // 자키: d1(1000), d2(2000) 제외되고 d4(5000) 150,000원만 반영
      expect(jaki?.account).toBe(150000);
      // 열음: d3(3000) 50,000원 반영
      expect(yeoreum?.toon).toBe(50000);

      // 원본 state는 불변이어야 함
      expect(testState.members[0].account).toBe(150000);
    });

    it("applies time filter to 777day/pongdang excel overlay (sig credits filtered by fromAt)", () => {
      const fromAt = 2500;
      const filtered = membersWithOverlayDonationAggregate(testState, testState.members, fromAt, { day777Calc: true });
      
      const jaki = filtered.find((m) => m.name === "자키");
      const yeoreum = filtered.find((m) => m.name === "열음");

      // 자키: d1(1000) 100,000원 시그 제외되고 d4(5000) 150,000원 시그만 반영 (777,000원은 기여도 제외)
      expect(jaki?.contribution).toBe(150000);
      // 열음: d3(3000) 50,000원 시그 반영
      expect(yeoreum?.contribution).toBe(50000);
    });
  });

  describe("2. Pongdang Reset vs Settlement Reset Isolation Bug Check", () => {
    it("settlement round contribution restore restores ONLY standard member contributions without polluting pongdang", () => {
      const stateBeforeRestore: AppState = {
        ...testState,
        members: [
          { id: "m_jaki", name: "자키", contribution: 0, account: 0, toon: 0 },
          { id: "m_yeoreum", name: "열음", contribution: 0, account: 0, toon: 0 },
        ],
        pongdangManualMode: false,
        pongdangManualContributions: { "m_jaki": 9999 },
      };

      const mockRecord: SettlementRecord = {
        id: "rec_1",
        title: "1회차 정산",
        createdAt: 1000,
        members: [
          { id: "m_jaki", name: "자키", contribution: 77777 } as any,
          { id: "m_yeoreum", name: "열음", contribution: 11111 } as any,
        ],
        totalGross: 0,
        totalFee: 0,
        totalNet: 0,
        memberPositionsAtSettlement: {},
      };

      const result = applyRoundContributionToState(stateBeforeRestore, mockRecord);
      const restored = result.nextState;

      // 표준 엑셀 멤버 contribution 복원 확인
      expect(restored.members.find((m) => m.id === "m_jaki")?.contribution).toBe(77777);
      expect(restored.members.find((m) => m.id === "m_yeoreum")?.contribution).toBe(11111);
      expect(result.restoredCount).toBe(2);

      // 퐁당퐁당 상태는 오염되지 않고 그대로 유지되어야 함
      expect(restored.pongdangManualMode).toBe(false);
      expect(restored.pongdangManualContributions?.["m_jaki"]).toBe(9999);
    });

    it("collectDay777SigContributionByMember recalculates pongdang contributions from raw donors independently", () => {
      const sigMap = collectDay777SigContributionByMember(testState);

      // d1(100,000) + d4(150,000) = 250,000
      expect(sigMap.get("m_jaki")).toBe(250000);
      // d3(50,000)
      expect(sigMap.get("m_yeoreum")).toBe(50000);
    });
  });

  describe("3. Preset Options & Theme Switching Bug Check", () => {
    it("switching to excelPongdang preserves accumulated contribution when no new sigs exist", () => {
      const stateWithSavedContrib: AppState = {
        ...testState,
        donors: [], // donors 비어있음
        members: [
          { id: "m_jaki", name: "자키", contribution: 45600, account: 0, toon: 0 },
          { id: "m_yeoreum", name: "열음", contribution: 1720, account: 0, toon: 0 },
        ],
      };

      const result = membersWithOverlayDonationAggregate(
        stateWithSavedContrib,
        stateWithSavedContrib.members,
        null,
        { day777Calc: true }
      );

      // 룰렛/시그 당첨이 아직 없어도 기존 누적 기여도 45,600 / 1,720이 0으로 날아가지 않아야 함
      expect(result.find((m) => m.name === "자키")?.contribution).toBe(45600);
      expect(result.find((m) => m.name === "열음")?.contribution).toBe(1720);
    });

    it("showRoleColumn false hides role column, true shows role column", () => {
      const hidden = resolveDonationTableColumnsOptions({ showRoleColumn: false });
      expect(hidden.showRoleColumn).toBe(false);

      const shown = resolveDonationTableColumnsOptions({ showRoleColumn: true });
      expect(shown.showRoleColumn).toBe(true);

      // pongdang default: showRoleColumn should be false
      const pongdangPreset = resolveDonationTableColumnsOptions({ day777Calc: true });
      expect(pongdangPreset.showRoleColumn).toBe(false);
    });

    it("ranking handles representative as null rank and members as 1..n", () => {
      const orderIndex = buildMemberCreationOrderIndex(testState.members);
      const getContribution = (m: Member) => m.contribution || 0;
      const roleMap: Record<string, string> = { "m_jaki": "대표" };

      const ranked = buildOverlayRankedMembers(
        testState.members,
        testState.memberPositions,
        (m) => roleMap[m.id] || "",
        testState.members,
        getContribution,
        testState.memberRankingMetric
      );

      expect(ranked).toHaveLength(4);
      // 대표는 rank null
      expect(ranked[0].m.name).toBe("자키");
      expect(ranked[0].rank).toBeNull();
      // 일반 멤버는 rank 1, 2, ...
      expect(ranked[1].m.name).toBe("열음");
      expect(ranked[1].rank).toBe(1);
    });
  });
});
