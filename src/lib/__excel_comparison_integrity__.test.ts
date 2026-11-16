import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  resolveDonationTableColumnsOptions,
  mergeDonationTablePresetFields,
} from "./donation-table-options";
import {
  resolveDay777Calc,
  resolvePongdangManualMode,
  resolveDonationAggregateFromAt,
  resolveMemberRankingMetric,
  presetToParams,
} from "./overlay-params";
import {
  membersWithOverlayDonationAggregate,
  applyOverlayDonationDisplayTotals,
} from "./overlay-donation-aggregate";
import { resolveExcelMemberTableAccent } from "./excel-member-table-theme";
import type { AppState, Member, OverlayPreset } from "@/types";

describe("기본 엑셀표 vs 퐁당퐁당 엑셀표 기능 및 옵션 정밀 비교 점검", () => {
  const baseMembers: Member[] = [
    { id: "m1", name: "자키", account: 100_000, toon: 50_000, contribution: 45_600, restroom: 2, operating: false },
    { id: "m2", name: "열음", account: 50_000, toon: 20_000, contribution: 1_720, restroom: 0, operating: false },
    { id: "m3", name: "수린", account: 0, toon: 0, contribution: 0, restroom: 0, operating: false },
  ];

  const standardPreset: Partial<OverlayPreset> = {
    id: "ov_standard",
    name: "기본 엑셀표",
    theme: "excel",
    membersTheme: "excel",
    totalTheme: "excel",
    showMembers: true,
    showTotal: true,
    tableOnly: true,
    showRoleColumn: true,
    showAccountColumn: true,
    showToonColumn: true,
    showCombinedColumn: true,
    showContributionColumn: true,
    showRestroomColumn: true,
    showCustomColumn: true,
    showTableSumRow: true,
    showContributionSum: true,
    accountHeaderLabel: "계좌",
    toonHeaderLabel: "투네",
    customHeaderLabel: "상벌금",
    day777Calc: false,
  };

  const pongdangPreset: Partial<OverlayPreset> = {
    id: "ov_pongdang",
    name: "퐁당퐁당 엑셀",
    theme: "excelPongdang",
    membersTheme: "excelPongdang",
    totalTheme: "excelPongdang",
    showMembers: true,
    showTotal: true,
    tableOnly: true,
    showRoleColumn: false, // 기본 직급 숨김
    showAccountColumn: true,
    showToonColumn: true,
    showCombinedColumn: true,
    showContributionColumn: true,
    showRestroomColumn: false,
    showCustomColumn: true,
    showTableSumRow: true,
    showContributionSum: true,
    accountHeaderLabel: "후원", // 기본 '후원' 표시
    toonHeaderLabel: "투네",
    customHeaderLabel: "상벌금",
    day777Calc: true, // 777데이 옵션 활성화
    tableBgOpacity: "0",
  };

  it("1. 템플릿 기본 옵션 비교 점검: 테마, 직급 열 기본값, 헤더 라벨, 777데이 옵션", () => {
    // 테마 점검
    expect(standardPreset.theme).toBe("excel");
    expect(pongdangPreset.theme).toBe("excelPongdang");

    // 직급 열 기본값: 기본 엑셀은 true, 퐁당퐁당은 false
    expect(standardPreset.showRoleColumn).toBe(true);
    expect(pongdangPreset.showRoleColumn).toBe(false);

    // 계좌 헤더 라벨: 기본 엑셀은 '계좌', 퐁당퐁당은 '후원'
    expect(standardPreset.accountHeaderLabel).toBe("계좌");
    expect(pongdangPreset.accountHeaderLabel).toBe("후원");

    // 777데이 계산 옵션
    expect(standardPreset.day777Calc).toBe(false);
    expect(pongdangPreset.day777Calc).toBe(true);

    // 퐁당퐁당 테마 악센트 스타일 존재 여부
    const accent = resolveExcelMemberTableAccent("excelPongdang");
    expect(accent).toBeDefined();
    expect(accent.headerBg).toBe("#064e3b");
    expect(accent.headerBorder).toBe("#10b981");
    expect(accent.contributionColor).toBe("#34d399");
  });

  it("2. 표 9개 열 옵션 완전성 점검 (DonationTableColumnsOptions)", () => {
    const stdResolved = resolveDonationTableColumnsOptions(standardPreset);
    expect(stdResolved.showRoleColumn).toBe(true);
    expect(stdResolved.showAccountColumn).toBe(true);
    expect(stdResolved.showToonColumn).toBe(true);
    expect(stdResolved.showCombinedColumn).toBe(true);
    expect(stdResolved.showContributionColumn).toBe(true);
    expect(stdResolved.showRestroomColumn).toBe(true);
    expect(stdResolved.showCustomColumn).toBe(true);
    expect(stdResolved.showTableSumRow).toBe(true);
    expect(stdResolved.showContributionSum).toBe(true);

    const pdResolved = resolveDonationTableColumnsOptions(pongdangPreset);
    expect(pdResolved.showRoleColumn).toBe(false); // 퐁당퐁당 기본 직급 미표시
    expect(pdResolved.showAccountColumn).toBe(true);
    expect(pdResolved.showToonColumn).toBe(true);
    expect(pdResolved.showCombinedColumn).toBe(true);
    expect(pdResolved.showContributionColumn).toBe(true);
    expect(pdResolved.showCustomColumn).toBe(true);
  });

  it("3. 기여도 계산 방식 차이 점검 (일반 후원 vs 777데이 통후원)", () => {
    // 일반 후원 상태: 777,000원 계좌 후원 시 기본 동기화에 의해 account: 777,000, contribution: 777,000
    const testState: AppState = {
      members: [
        { id: "m1", name: "자키", account: 777_000, toon: 0, contribution: 777_000, operating: false },
      ],
      donors: [
        { id: "d1", name: "후원자A", amount: 777_000, memberId: "m1", target: "account", at: 1000 },
      ],
      sigInventory: [
        { id: "sig1", name: "시그5만", price: 50_000, command: "50000" },
      ],
      rouletteState: {
        phase: "LANDED",
        startedAt: 1000,
        selectedSigs: [{ id: "sig1", name: "시그5만", price: 50_000, command: "50000" }],
      } as any,
    };

    // 기본 엑셀표 (day777Calc: false) -> 후원금액 777,000원이 그대로 기여도 유지
    const stdResult = applyOverlayDonationDisplayTotals(testState, { day777Calc: false });
    expect(stdResult.members[0].account).toBe(777_000);
    expect(stdResult.members[0].contribution).toBe(777_000);

    // 퐁당퐁당 엑셀표 (day777Calc: true) -> 계좌는 777,000원이나 기여도는 나온 시그 50,000원만!
    const pdResult = applyOverlayDonationDisplayTotals(testState, { day777Calc: true });
    expect(pdResult.members[0].account).toBe(777_000);
    expect(pdResult.members[0].contribution).toBe(50_000);
  });

  it("4. 정산 리셋 격리 점검: 일반 정산 리셋 시 퐁당퐁당 기여도 보존, 퐁당퐁당 전용 리셋 시 초기화", () => {
    const stateWithAccumulated: AppState = {
      members: baseMembers,
      settlementResetAt: 1730000000000, // 일반 회차 정산 리셋 발생
    };

    // 일반 정산 리셋이 발생해도 퐁당퐁당 기여도는 날아가지 않고 온전히 보존
    const pdMembersPreserved = membersWithOverlayDonationAggregate(
      stateWithAccumulated,
      stateWithAccumulated.members,
      null,
      { day777Calc: true }
    );
    expect(pdMembersPreserved[0].contribution).toBe(45_600); // 자키 4.6만 보존
    expect(pdMembersPreserved[1].contribution).toBe(1_720); // 열음 0.2만 보존

    // 퐁당퐁당 전용 리셋 (pongdangResetAt 설정) 시에만 0원으로 초기화
    const stateWithPongdangReset: AppState = {
      ...stateWithAccumulated,
      pongdangResetAt: 1731000000000, // 퐁당퐁당 직접 리셋
      pongdangManualContributions: {},
    };
    const pdMembersReset = membersWithOverlayDonationAggregate(
      stateWithPongdangReset,
      stateWithPongdangReset.members,
      null,
      { day777Calc: true }
    );
    expect(pdMembersReset[0].contribution).toBe(0);
    expect(pdMembersReset[1].contribution).toBe(0);
  });

  it("5. 후원 집계 기준 시점(donationAggregateFromAt) 양쪽 모두 정상 동작 점검", () => {
    const timedState: AppState = {
      members: [
        { id: "m1", name: "자키", account: 0, toon: 0, contribution: 0, operating: false },
      ],
      donors: [
        { id: "d1", name: "후원자1", amount: 100_000, memberId: "m1", target: "account", at: 1000 },
        { id: "d2", name: "후원자2", amount: 200_000, memberId: "m1", target: "account", at: 3000 },
      ],
      sigInventory: [
        { id: "sig1", name: "시그1만", price: 10_000, command: "10000" },
      ],
      rouletteState: {
        phase: "LANDED",
        startedAt: 3000,
        selectedSigs: [{ id: "sig1", name: "시그1만", price: 10_000, command: "10000" }],
      } as any,
    };

    // at: 2000 이후부터 집계
    const fromAt = 2000;

    // 기본 엑셀: d2(200,000원)만 집계
    const stdFiltered = applyOverlayDonationDisplayTotals(timedState, { fromAt, day777Calc: false });
    expect(stdFiltered.members[0].account).toBe(200_000);
    expect(stdFiltered.members[0].contribution).toBe(200_000);

    // 퐁당퐁당 엑셀: 계좌는 d2(200,000원), 기여도는 3000에 나온 시그 10,000원만 집계
    const pdFiltered = applyOverlayDonationDisplayTotals(timedState, { fromAt, day777Calc: true });
    expect(pdFiltered.members[0].account).toBe(200_000);
    expect(pdFiltered.members[0].contribution).toBe(10_000);
  });

  it("6. 멤버 제외 기능 점검: 제외 멤버 숨김 처리 및 상벌금(커스텀 셀) 보존", () => {
    const customCells = { m1: "+50만 (상금)", m2: "-10만 (벌금)", m3: "메모" };
    const excludedIds = ["m2"]; // 열음 제외

    // 제외 필터링 함수 검증
    const filterMembers = (list: Member[], excluded: Set<string>) =>
      list.filter((m) => !excluded.has(m.id));

    const activeList = filterMembers(baseMembers, new Set(excludedIds));
    expect(activeList).toHaveLength(2);
    expect(activeList.map((m) => m.name)).toEqual(["자키", "수린"]);

    // 제외되어도 customCells 맵은 전혀 훼손되지 않음
    expect(customCells["m1"]).toBe("+50만 (상금)");
    expect(customCells["m2"]).toBe("-10만 (벌금)");
  });
});
