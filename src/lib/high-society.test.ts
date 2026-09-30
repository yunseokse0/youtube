import { describe, expect, it } from "vitest";
import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import {
  buildHighSocietyFieldFromMembers,
  buildHighSocietyTerritory,
  buildHighSocietyZones,
  detectHighSocietyGrowFlashSeatIds,
  donationToExpandCm,
  formatCm,
  formatSeatWidthCm,
  formatHighSocietyTimer,
  formatManWon,
  HIGH_SOCIETY_DEFAULT_FIELD_CM,
  HIGH_SOCIETY_TEST_MEMBERS,
  parseHighSocietyBarStyle,
  parseHighSocietyRound,
  parseHighSocietySplit,
  parseHighSocietyTerritoryUpdateMode,
  normalizeHighSocietySettings,
  normalizeZeroCmGaugeDisplay,
  shouldShowZeroCmSeatsOnGauge,
  normalizeHighSocietyFxSettings,
  defaultHighSocietyFxSettings,
  highSocietyFxToHsFxParam,
  parseHighSocietyFxFromHsFxParam,
  mergeHighSocietyDonationLinksOnSettingsChange,
  territoryLabelMapAfterEdit,
  shouldKeepLocalHighSocietySettings,
  isSeatMemberIdsReorderOnly,
  shouldClearMemberWidthSnapshotOnSeatChange,
  effectiveHighSocietySeatOrder,
  buildTerritoryPauseToggleSettingsPatch,
  normalizeTerritoryPauseExcludeWindows,
  markDonorsForHighSocietyTerritoryRoundBump,
  markDonorsHsTerritoryExcluded,
  mergeDonorRostersPreferFullest,
  resolveDonorsForHighSocietySettingsPatch,
  shouldMarkDonorsLocallyForHighSocietySettingsPatch,
  shouldPersistDonorsForHighSocietySettingsPatch,
  shouldApplyDonorsForHighSocietySettingsPatch,
  resolveDonationSyncModeForHighSocietySettingsChange,
  isHighSocietyReopen,
  isHighSocietyDonationIngestPaused,
  shouldDonorCountForHighSocietyTerritory,
  fieldCmFromStartPerMember,
  startCmFromField,
  parseHighSocietyFieldCm,
  parseHighSocietyStartCmPerMember,
  resolveHighSocietyField,
  resolveHighSocietyFieldWithMemberWidths,
  resolveHighSocietySeatMembers,
  resolveHighSocietyStartCmPerMember,
  resolveHighSocietyEffectiveFieldCm,
  reconcileHighSocietyFieldDimensions,
  pruneHighSocietySeatMemberIds,
  resolveHighSocietySeatCountForField,
  resolveHighSocietyDonationLink,
  buildHighSocietyFieldFromAppState,
  isDefaultLikeHighSocietySettings,
  isMeaningfulHighSocietySettings,
  shouldBlockHighSocietyRegression,
  isHighSocietySeatSelectionManual,
  resolveHighSocietySeatMemberIdsForEdit,
  appendHighSocietySeatMemberId,
  eliminatedSeatEndIndex,
  insertHighSocietySeatMemberIdAt,
  moveHighSocietySeatMemberToIndex,
  placeHighSocietyPendingEndMember,
  mergeHighSocietySettingsPreferBaseline,
  pendingEndEntryIdsAfterIncomingSettings,
  defaultHighSocietySettings,
  isDonationAmountEligibleForHighSocietyTerritory,
  highSocietyAdminPreviewSig,
  highSocietyAdminPreviewIframeKeySig,
  syncHighSocietyMemberWidthSnapshotInState,
  shouldSyncHighSocietyMemberWidthSnapshot,
  highSocietyNeedsMemberWidthSnapshotPersist,
  appendTerritoryLogToAppState,
  removeTerritoryLogFromAppState,
  resolveHighSocietyOverlayGaugeSeats,
  holdHighSocietyOverlayGaugeIfPending,
  aggregateTeamPushesFromTerritoryLogs,
  aggregateHighSocietySeatsByTeam,
  normalizeTeam,
  resolveTeamColor,
  applyTerritoryLogDirectTransfers,
} from "./high-society";
import { createTerritoryLog } from "./territory-utils";

/** 후원 리스트「영토 ON」— 수동 반영 테스트용 */
const hsTerritoryOn = { hsTerritoryExcluded: false as const };

describe("high-society rule field", () => {
  it("converts donation — only exact 1만원 multiples × 5cm", () => {
    expect(donationToExpandCm(0)).toBe(0);
    expect(donationToExpandCm(9999)).toBe(0);
    expect(donationToExpandCm(10000)).toBe(5);
    expect(donationToExpandCm(10900)).toBe(0);
    expect(donationToExpandCm(16900)).toBe(0);
    expect(donationToExpandCm(20000)).toBe(10);
    expect(donationToExpandCm(26_000)).toBe(0);
    expect(donationToExpandCm(100000)).toBe(50);
  });

  it("isDonationAmountEligibleForHighSocietyTerritory matches 1만원 배수 rule", () => {
    expect(isDonationAmountEligibleForHighSocietyTerritory(100)).toBe(false);
    expect(isDonationAmountEligibleForHighSocietyTerritory(1000)).toBe(false);
    expect(isDonationAmountEligibleForHighSocietyTerritory(13_000)).toBe(false);
    expect(isDonationAmountEligibleForHighSocietyTerritory(14_600)).toBe(false);
    expect(isDonationAmountEligibleForHighSocietyTerritory(10_000)).toBe(true);
    expect(isDonationAmountEligibleForHighSocietyTerritory(20_000)).toBe(true);
  });

  it("shouldDonorCountForHighSocietyTerritory never counts donors (territory log only)", () => {
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a"],
      donationLinks: { a: { active: true, startedAt: 0 } },
    });
    const link = { active: true, startedAt: 0 };
    expect(
      shouldDonorCountForHighSocietyTerritory(
        { amount: 13_000, at: 100, donationExcluded: false },
        settings,
        link
      )
    ).toBe(false);
    expect(
      shouldDonorCountForHighSocietyTerritory(
        { amount: 10_000, at: 100, donationExcluded: false, hsTerritoryExcluded: false },
        settings,
        link
      )
    ).toBe(false);
    expect(
      shouldDonorCountForHighSocietyTerritory(
        { amount: 10_000, at: 100, donationExcluded: false },
        settings,
        link
      )
    ).toBe(false);
  });

  it("starts equal N-way split of fixed field", () => {
    const { seats, startCm, fieldCm, playerCount } = resolveHighSocietyField({
      players: [
        { id: "a", name: "A", donationWon: 0 },
        { id: "b", name: "B", donationWon: 0 },
        { id: "c", name: "C", donationWon: 0 },
      ],
    });
    expect(fieldCm).toBe(HIGH_SOCIETY_DEFAULT_FIELD_CM);
    expect(playerCount).toBe(3);
    expect(startCm).toBe(400);
    expect(seats.map((s) => s.widthCm)).toEqual([400, 400, 400]);
    expect(seats.every((s) => !s.eliminated)).toBe(true);
  });

  it("starts equal when no donations (4)", () => {
    const { seats, startCm, fieldCm } = resolveHighSocietyField({
      players: [
        { id: "a", name: "A", donationWon: 0 },
        { id: "b", name: "B", donationWon: 0 },
        { id: "c", name: "C", donationWon: 0 },
        { id: "d", name: "D", donationWon: 0 },
      ],
    });
    expect(fieldCm).toBe(HIGH_SOCIETY_DEFAULT_FIELD_CM);
    expect(startCm).toBe(300);
    expect(seats.map((s) => s.widthCm)).toEqual([300, 300, 300, 300]);
    expect(seats.every((s) => !s.eliminated)).toBe(true);
  });

  it("A only expands right into B", () => {
    const { seats } = resolveHighSocietyField({
      players: [
        { id: "a", name: "A", expandRightCm: 50 },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
        { id: "d", name: "D" },
      ],
    });
    expect(seats[0]!.widthCm).toBe(350);
    expect(seats[1]!.widthCm).toBe(250);
    expect(seats[2]!.widthCm).toBe(300);
    expect(seats[3]!.widthCm).toBe(300);
  });

  it("D only expands left into C", () => {
    const { seats } = resolveHighSocietyField({
      players: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
        { id: "d", name: "D", expandLeftCm: 20 },
      ],
    });
    expect(seats[3]!.widthCm).toBe(320);
    expect(seats[2]!.widthCm).toBe(280);
  });

  it("B all-left push expands into A", () => {
    const { seats } = resolveHighSocietyField({
      players: [
        { id: "a", name: "A" },
        { id: "b", name: "B", expandLeftCm: 30 },
        { id: "c", name: "C" },
        { id: "d", name: "D" },
      ],
    });
    expect(seats[1]!.widthCm).toBe(330);
    expect(seats[0]!.widthCm).toBe(270);
    expect(seats[2]!.widthCm).toBe(300);
  });

  it("uses absolute left/right cm from donation directions", () => {
    const { seats } = resolveHighSocietyField({
      players: [
        { id: "a", name: "A", donationWon: 0, expandLeftCm: 0, expandRightCm: 0 },
        { id: "b", name: "B", donationWon: 100_000, expandLeftCm: 0, expandRightCm: 50 },
        { id: "c", name: "C", donationWon: 0, expandLeftCm: 0, expandRightCm: 0 },
        { id: "d", name: "D", donationWon: 0, expandLeftCm: 0, expandRightCm: 0 },
      ],
    });
    expect(seats[1]!.widthCm).toBe(350);
    expect(seats[2]!.widthCm).toBe(250);
  });

  it("keeps unequal end widths when middle is depleted (105 vs 220 expand)", () => {
    const { seats } = resolveHighSocietyField({
      fieldCm: 400,
      players: [
        { id: "jaki", name: "자키", donationWon: 0, expandRightCm: 105, expandLeftCm: 0 },
        { id: "isia", name: "이시아", donationWon: 0 },
        { id: "siu", name: "윤시우", donationWon: 0, expandRightCm: 15, expandLeftCm: 0 },
        { id: "gayeon", name: "가여니", donationWon: 0, expandLeftCm: 220, expandRightCm: 0 },
      ],
    });
    const jaki = seats.find((s) => s.id === "jaki")!;
    const gayeon = seats.find((s) => s.id === "gayeon")!;
    expect(gayeon.widthCm).toBeGreaterThan(jaki.widthCm);
    expect(jaki.widthCm + gayeon.widthCm).toBeCloseTo(400, 0);
    expect(jaki.widthCm).not.toBe(gayeon.widthCm);
  });

  it("eliminates a seat that loses all width (cushion)", () => {
    const { seats, cushion } = resolveHighSocietyField({
      players: [
        { id: "a", name: "A", expandRightCm: 300 },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
        { id: "d", name: "D" },
      ],
    });
    expect(seats[0]!.widthCm).toBe(600);
    expect(seats[1]!.eliminated).toBe(true);
    expect(cushion.map((c) => c.letter)).toEqual(["B"]);
  });

  it("maps all non-operating members (N-way)", () => {
    const { seats, leader, playerCount, startCm } = buildHighSocietyFieldFromMembers(
      HIGH_SOCIETY_TEST_MEMBERS,
      { split: { bLeft: 0.5, cLeft: 0.5 } }
    );
    expect(playerCount).toBe(4);
    expect(startCm).toBe(300);
    expect(seats.map((s) => s.name)).toEqual(["금수저", "은수저", "동수저", "흑수저"]);
    expect(leader?.name).toBeTruthy();
    const sum = seats.reduce((s, x) => s + x.widthCm, 0);
    expect(sum).toBeCloseTo(HIGH_SOCIETY_DEFAULT_FIELD_CM, 0);
  });

  it("parses split and bar styles (flat / arrow)", () => {
    expect(parseHighSocietyBarStyle("")).toBe("flat");
    expect(parseHighSocietyBarStyle("flat")).toBe("flat");
    expect(parseHighSocietyBarStyle("lanes")).toBe("flat");
    expect(parseHighSocietyBarStyle("field")).toBe("flat");
    expect(parseHighSocietyBarStyle("arrow")).toBe("arrow");
    expect(parseHighSocietyBarStyle("chevron")).toBe("arrow");
    expect(parseHighSocietySplit("70", "30")).toEqual({ bLeft: 0.7, cLeft: 0.3 });
    expect(parseHighSocietySplit("0.2", "0.8")).toEqual({ bLeft: 0.2, cLeft: 0.8 });
    expect(formatCm(305)).toBe("305cm");
    expect(formatCm(230.1)).toBe("230.1cm");
    expect(formatCm(7.5)).toBe("7.5cm");
    expect(formatSeatWidthCm(0, "00cm")).toBe("00cm");
    expect(formatSeatWidthCm(0, "0cm")).toBe("0cm");
    expect(formatSeatWidthCm(0, "hidden")).toBe("0cm");
    expect(formatSeatWidthCm(12, "00cm")).toBe("12cm");
    expect(normalizeZeroCmGaugeDisplay("00")).toBe("00cm");
    expect(shouldShowZeroCmSeatsOnGauge("00cm")).toBe(true);
    expect(shouldShowZeroCmSeatsOnGauge("hidden")).toBe(false);
    expect(normalizeHighSocietySettings({ zeroCmGaugeDisplay: "00cm" }).zeroCmGaugeDisplay).toBe(
      "00cm"
    );
    expect(normalizeHighSocietySettings({ zeroCmGaugeDisplay: "hidden" }).zeroCmGaugeDisplay).toBe(
      undefined
    );
  });

  it("seat widthCm stays whole cm after field scale (no 0.1cm artifacts)", () => {
    const { seats } = resolveHighSocietyFieldWithMemberWidths({
      fieldCm: 400,
      players: [
        { id: "jaki", name: "자키", donationWon: 6_523_300 },
        { id: "isia", name: "이시아", donationWon: 207_000 },
        { id: "gayeon", name: "가여니", donationWon: 5_343_400 },
      ],
      widthByMemberId: { jaki: 230.1, isia: 20.7, gayeon: 149.2 },
    });
    expect(seats.map((s) => s.widthCm)).toEqual([230, 21, 149]);
    expect(seats.reduce((sum, s) => sum + s.widthCm, 0)).toBe(400);
  });

  it("3-player equal start uses integer cm widths", () => {
    const { seats } = resolveHighSocietyField({
      fieldCm: 400,
      players: [
        { id: "a", name: "A", donationWon: 0 },
        { id: "b", name: "B", donationWon: 0 },
        { id: "c", name: "C", donationWon: 0 },
      ],
    });
    expect(seats.every((s) => Number.isInteger(s.widthCm))).toBe(true);
    expect(seats.reduce((sum, s) => sum + s.widthCm, 0)).toBe(400);
  });

  it("parses round number", () => {
    expect(parseHighSocietyRound(undefined)).toBe(1);
    expect(parseHighSocietyRound("3")).toBe(3);
    expect(parseHighSocietyRound("0")).toBe(1);
    expect(parseHighSocietyRound("150")).toBe(99);
  });
});

describe("high-society territory (aux)", () => {
  it("builds pct slices from account+toon", () => {
    const { slices, total, leader } = buildHighSocietyTerritory(HIGH_SOCIETY_TEST_MEMBERS);
    expect(total).toBe(320000 + 180000 + 90000 + 50000);
    expect(leader?.name).toBe("금수저");
    expect(slices.length).toBe(4);
    const pctSum = slices.reduce((s, x) => s + x.pct, 0);
    expect(pctSum).toBeGreaterThan(99);
    expect(pctSum).toBeLessThan(101);
  });

  it("skips operating and zero amounts", () => {
    const { slices } = buildHighSocietyTerritory([
      { id: "a", name: "A", account: 10000, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 5000, toon: 0, operating: true },
    ]);
    expect(slices.map((s) => s.name)).toEqual(["A"]);
    expect(slices[0]?.pct).toBe(100);
  });

  it("fills 4 minimap zones from field seats", () => {
    const { seats } = buildHighSocietyFieldFromMembers(HIGH_SOCIETY_TEST_MEMBERS);
    const zones = buildHighSocietyZones(seats);
    expect(zones).toHaveLength(4);
    expect(zones[0]?.ownerName).toBe("금수저");
  });

  it("formats timer and man-won", () => {
    expect(formatHighSocietyTimer(125)).toBe("02:05");
    expect(formatHighSocietyTimer(3723)).toBe("01:02:03");
    expect(formatManWon(50000)).toBe("5만");
  });

  it("parses territory update mode — onRoundEnd 저장값은 realtime 으로 정규화", () => {
    expect(parseHighSocietyTerritoryUpdateMode("realtime")).toBe("realtime");
    expect(parseHighSocietyTerritoryUpdateMode("onRoundEnd")).toBe("realtime");
    expect(parseHighSocietyTerritoryUpdateMode("end")).toBe("realtime");
    expect(parseHighSocietyTerritoryUpdateMode("")).toBe("realtime");
    expect(normalizeHighSocietySettings({ territoryUpdateMode: "onRoundEnd" }).territoryUpdateMode).toBe(
      "realtime"
    );
  });

  it("maps 1인 시작 cm ↔ 전장 총길이", () => {
    expect(fieldCmFromStartPerMember(400, 4)).toBe(1600);
    expect(startCmFromField(1600, 4)).toBe(400);
    expect(startCmFromField(1200, 4)).toBe(300);
    expect(parseHighSocietyFieldCm("1600")).toBe(1600);
    expect(parseHighSocietyStartCmPerMember("400")).toBe(400);
  });

  it("1 explicit seat uses 100cm field not 200 (no phantom 2nd player)", () => {
    const members = [{ id: "a", name: "A", account: 0, toon: 0, operating: false }];
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a"],
      startCmPerMember: 100,
    });
    expect(settings.fieldCm).toBe(100);
    expect(resolveHighSocietySeatCountForField(settings, 1)).toBe(1);
    expect(resolveHighSocietyEffectiveFieldCm(settings, 1)).toBe(100);
    const { seats } = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: settings,
    });
    expect(seats).toHaveLength(1);
    expect(seats[0]!.widthCm).toBe(100);
  });

  it("정산 리셋 시각이 있어도 저장된 영토 cm 는 100cm로 되돌리지 않는다", () => {
    const resetAt = 5_000_000;
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
    ];
    const { seats } = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      settlementResetAt: resetAt,
      territoryLogs: [
        { id: "old", memberId: "a", amount: 30, delta: 1, at: resetAt - 10_000, pushDir: "right" },
      ],
      highSocietySettings: normalizeHighSocietySettings({
        seatMemberIds: ["a", "b"],
        startCmPerMember: 100,
        memberWidthCm: { a: 169, b: 31 },
      }),
    });
    expect(seats.map((s) => s.widthCm)).toEqual([169, 31]);
  });

  it("field seat count follows resolved players not ghost seatMemberIds", () => {
    const members = [
      { id: "a", name: "자키", account: 0, toon: 0, operating: false },
      { id: "b", name: "수빈", account: 0, toon: 0, operating: false },
      { id: "c", name: "지수", account: 0, toon: 0, operating: false },
    ];
    const settings = normalizeHighSocietySettings({
      seatMemberIds: ["a", "b", "c", "gone1", "gone2", "gone3"],
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      fieldCm: 600,
    });
    expect(resolveHighSocietySeatCountForField(settings, 3)).toBe(3);
    expect(resolveHighSocietyEffectiveFieldCm(settings, 3)).toBe(300);
    const reconciled = reconcileHighSocietyFieldDimensions(settings, 3, members);
    expect(reconciled.seatMemberIds).toEqual(["a", "b", "c"]);
    expect(reconciled.fieldCm).toBe(300);
  });

  it("territory log push dir changes neighbor widths (not donors)", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const baseSettings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      defaultMiddlePush: "right",
      territoryUpdateMode: "realtime",
    });
    const applyDir = (pushDir: "left" | "right") => {
      const state = appendTerritoryLogToAppState(
        {
          members,
          donors: [],
          highSocietySettings: baseSettings,
          territoryLogs: [],
        } as import("@/types").AppState,
        createTerritoryLog("b", 1, 50, { pushDir })
      );
      return buildHighSocietyFieldFromAppState(state);
    };
    const rightPush = applyDir("right");
    const leftPush = applyDir("left");
    expect(rightPush.seats[1]!.widthCm).toBe(350);
    expect(rightPush.seats[2]!.widthCm).toBe(250);
    expect(leftPush.seats[1]!.widthCm).toBe(350);
    expect(leftPush.seats[0]!.widthCm).toBe(250);
    expect(leftPush.seats[2]!.widthCm).toBe(300);
  });

  it("donors never change field width (territory ON ignored)", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const baseSettings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      defaultMiddlePush: "right",
      donationLinks: {
        b: { active: true, startedAt: 5000 },
      },
    });
    const withoutToggle = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-new",
          name: "후원",
          amount: 100_000,
          memberId: "b",
          target: "account",
          at: 6000,
          hsPushDir: "right",
        },
      ],
      highSocietySettings: baseSettings,
    });
    const withToggle = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-new",
          name: "후원",
          amount: 100_000,
          memberId: "b",
          target: "account",
          at: 6000,
          hsPushDir: "right",
          ...hsTerritoryOn,
        },
      ],
      highSocietySettings: baseSettings,
    });
    expect(withoutToggle.seats[1]!.widthCm).toBe(300);
    expect(withToggle.seats[1]!.widthCm).toBe(300);
  });

  it("keeps territory when mode is toggled off (width snapshot)", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const donors = [
      {
        id: "d1",
        name: "후원",
        amount: 100_000,
        memberId: "b",
        target: "account" as const,
        at: 6000,
        hsPushDir: "right" as const,
        ...hsTerritoryOn,
      },
    ];
    const onSettings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      defaultMiddlePush: "right",
      memberWidthCm: { a: 250, b: 350, c: 300, d: 300 },
      memberWidthDonationSnapshot: { a: 0, b: 0, c: 0, d: 0 },
    });
    const offSettings = normalizeHighSocietySettings({
      ...onSettings,
      enabled: false,
      territoryCutoffAt: 7000,
    });
    const onField = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: onSettings,
    });
    const offField = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: offSettings,
    });
    expect(offField.seats[1]!.widthCm).toBe(onField.seats[1]!.widthCm);
    expect(offField.seats[1]!.widthCm).toBe(350);
  });

  it("ignores donations after OFF cutoff while mode is disabled", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const settings = normalizeHighSocietySettings({
      enabled: false,
      seatMemberIds: ["a", "b", "c", "d"],
      defaultMiddlePush: "right",
      territoryCutoffAt: 5000,
      donationLinks: { b: { active: true, startedAt: 0 } },
    });
    const frozen = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-old",
          name: "old",
          amount: 100_000,
          memberId: "b",
          target: "account" as const,
          at: 4000,
          hsPushDir: "right" as const,
          ...hsTerritoryOn,
        },
      ],
      highSocietySettings: settings,
    });
    const withNew = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-old",
          name: "old",
          amount: 100_000,
          memberId: "b",
          target: "account" as const,
          at: 4000,
          hsPushDir: "right" as const,
          ...hsTerritoryOn,
        },
        {
          id: "d-new",
          name: "new",
          amount: 200_000,
          memberId: "b",
          target: "account" as const,
          at: 9000,
          hsPushDir: "right" as const,
        },
      ],
      highSocietySettings: settings,
    });
    expect(frozen.seats[1]!.widthCm).toBe(300);
    expect(withNew.seats[1]!.widthCm).toBe(300);
  });

  it("ignores donations when OFF without territoryCutoffAt (legacy/broken state)", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const settings = normalizeHighSocietySettings({
      enabled: false,
      seatMemberIds: ["a", "b", "c", "d"],
      defaultMiddlePush: "right",
      donationLinks: { b: { active: true, startedAt: 0 } },
    });
    const link = resolveHighSocietyDonationLink(settings, "b");
    expect(
      shouldDonorCountForHighSocietyTerritory(
        {
          amount: 10_000,
          at: 9000,
          target: "account" as const,
        } as const,
        settings,
        link
      )
    ).toBe(false);
    const field = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-new",
          name: "new",
          amount: 10_000,
          memberId: "b",
          target: "account" as const,
          at: 9000,
          hsPushDir: "right" as const,
        },
      ],
      highSocietySettings: settings,
    });
    expect(field.seats[1]!.widthCm).toBe(300);
  });

  it("ignores donations after territory pause while mode stays ON", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      defaultMiddlePush: "right",
      territoryPaused: true,
      territoryPausedAt: 7000,
      donationLinks: { b: { active: true, startedAt: 0 } },
    });
    const frozen = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-old",
          name: "old",
          amount: 100_000,
          memberId: "b",
          target: "account" as const,
          at: 4000,
          hsPushDir: "right" as const,
          ...hsTerritoryOn,
        },
      ],
      highSocietySettings: settings,
    });
    const withNew = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-old",
          name: "old",
          amount: 100_000,
          memberId: "b",
          target: "account" as const,
          at: 4000,
          hsPushDir: "right" as const,
          ...hsTerritoryOn,
        },
        {
          id: "d-new",
          name: "new",
          amount: 200_000,
          memberId: "b",
          target: "account" as const,
          at: 9000,
          hsPushDir: "right" as const,
        },
      ],
      highSocietySettings: settings,
    });
    expect(frozen.seats[1]!.widthCm).toBe(300);
    expect(withNew.seats[1]!.widthCm).toBe(300);
  });

  it("after territory resume, pause-window donations stay excluded from territory", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const resumed = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      defaultMiddlePush: "right",
      territoryPaused: false,
      territoryPauseExcludeWindows: [{ from: 7000, to: 10_000 }],
      donationLinks: { b: { active: true, startedAt: 0 } },
    });
    const state = appendTerritoryLogToAppState(
      {
        members,
        donors: [],
        highSocietySettings: resumed,
        territoryLogs: [],
      } as import("@/types").AppState,
      createTerritoryLog("b", 1, 50, { pushDir: "right" })
    );
    const field = buildHighSocietyFieldFromAppState(state);
    expect(field.seats[1]!.widthCm).toBe(350);
  });

  it("buildTerritoryPauseToggleSettingsPatch appends exclude window on resume", () => {
    const prev = normalizeHighSocietySettings({
      enabled: true,
      territoryPaused: true,
      territoryPausedAt: 5000,
    });
    const patch = buildTerritoryPauseToggleSettingsPatch(
      { territoryPaused: false },
      prev,
      9000
    );
    expect(patch.territoryPausedAt).toBeUndefined();
    expect(normalizeTerritoryPauseExcludeWindows(patch.territoryPauseExcludeWindows)).toEqual([
      { from: 5000, to: 9000 },
    ]);
  });

  it("clears territory pause when toggling OFF", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
    ];
    const prev = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
      territoryPaused: true,
      territoryPausedAt: 5000,
    });
    const next = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: prev,
      nextSettings: normalizeHighSocietySettings({ ...prev, enabled: false }),
      members,
      now: 12_345,
    });
    expect(next.territoryPaused).toBe(false);
    expect(next.territoryPausedAt).toBeUndefined();
    expect(next.donationSyncModeBeforePause).toBeUndefined();
  });

  it("영토 이름과 색은 멤버 명단·자리 순서와 따로 유지된다", () => {
    const members = [
      { id: "a", name: "유리", account: 0, toon: 0, operating: false },
      { id: "b", name: "자키", account: 0, toon: 0, operating: false },
    ];
    const prev = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
      seatMemberIdsManual: true,
      startCmPerMember: 100,
    });
    const moved = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: prev,
      nextSettings: normalizeHighSocietySettings({
        ...prev,
        seatMemberIds: ["b", "a"],
      }),
      members,
      territoryLogs: [],
      now: 20_000,
    });
    expect(moved.territoryColorByMemberId?.a).toBe("#2563eb");
    expect(moved.territoryColorByMemberId?.b).toBe("#16a34a");
    const named = normalizeHighSocietySettings({
      ...moved,
      territoryLabelByMemberId: { a: "유리팀" },
      territoryColorByMemberId: { ...moved.territoryColorByMemberId, a: "#112233" },
    });
    const field = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: named,
      territoryLogs: [],
    });
    const seatA = field.seats.find((seat) => seat.id === "a");
    const seatB = field.seats.find((seat) => seat.id === "b");
    expect(seatA?.name).toBe("유리팀");
    expect(seatA?.color).toBe("#112233");
    expect(seatB?.name).toBe("자키");
    expect(seatB?.color).toBe("#16a34a");
  });

  it("게이지 이름을 멤버 이름과 같게 적어도 그 문자열이 오버레이에 남는다", () => {
    const map = territoryLabelMapAfterEdit({ a: "곽" }, "a", "곽호경");
    expect(map.a).toBe("곽호경");
    const members = [{ id: "a", name: "곽", account: 0, toon: 0, operating: false }];
    const field = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["a"],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        territoryLabelByMemberId: map,
      }),
      territoryLogs: [],
    });
    expect(field.seats[0]?.name).toBe("곽호경");
  });

  it("isHighSocietyDonationIngestPaused is always false (territory pause does not block ingest)", () => {
    expect(
      isHighSocietyDonationIngestPaused({
        highSocietySettings: normalizeHighSocietySettings({ enabled: true, territoryPaused: true }),
      })
    ).toBe(false);
    expect(
      isHighSocietyDonationIngestPaused({
        highSocietySettings: normalizeHighSocietySettings({ enabled: false, territoryPaused: true }),
      })
    ).toBe(false);
    expect(
      isHighSocietyDonationIngestPaused({
        highSocietySettings: normalizeHighSocietySettings({ enabled: true, territoryPaused: false }),
      })
    ).toBe(false);
  });

  it("sets territoryCutoffAt when toggling OFF", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
    ];
    const prev = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
    });
    const next = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: prev,
      nextSettings: normalizeHighSocietySettings({ ...prev, enabled: false }),
      members,
      now: 12_345,
    });
    expect(next.enabled).toBe(false);
    expect(next.territoryCutoffAt).toBe(12_345);
    expect(next.territoryReopenAt).toBeUndefined();
  });

  it("re-ON sets territoryReopenAt and keeps last OFF cutoff + donationLinks", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const prev = normalizeHighSocietySettings({
      enabled: false,
      seatMemberIds: ["a", "b", "c", "d"],
      territoryCutoffAt: 80_000,
      donationLinks: { b: { active: true, startedAt: 5000 } },
    });
    const next = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: prev,
      nextSettings: normalizeHighSocietySettings({ ...prev, enabled: true }),
      members,
      now: 99_000,
    });
    expect(next.donationLinks?.b?.startedAt).toBe(5000);
    expect(next.territoryCutoffAt).toBe(80_000);
    expect(next.territoryReopenAt).toBe(99_000);
  });

  it("re-ON keeps baseline territory snapshot (donors do not expand)", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const baseDonor = {
      id: "d1",
      name: "base",
      amount: 100_000,
      memberId: "b",
      target: "account" as const,
      at: 6000,
      hsPushDir: "right" as const,
      ...hsTerritoryOn,
    };
    const onSettings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      defaultMiddlePush: "right",
      memberWidthCm: { a: 250, b: 350, c: 300, d: 300 },
      memberWidthDonationSnapshot: { a: 0, b: 0, c: 0, d: 0 },
    });
    const onField = buildHighSocietyFieldFromAppState({
      members,
      donors: [baseDonor],
      highSocietySettings: onSettings,
    });
    const offSettings = normalizeHighSocietySettings({
      ...onSettings,
      enabled: false,
      territoryCutoffAt: 7000,
    });
    const offField = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        baseDonor,
        {
          id: "d-off",
          name: "off",
          amount: 200_000,
          memberId: "b",
          target: "account" as const,
          at: 8000,
          hsPushDir: "right" as const,
        },
      ],
      highSocietySettings: offSettings,
    });
    expect(offField.seats[1]!.widthCm).toBe(onField.seats[1]!.widthCm);

    const reOnSettings = normalizeHighSocietySettings({
      ...offSettings,
      enabled: true,
      territoryReopenAt: 9000,
    });
    const reOnBaseline = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        baseDonor,
        {
          id: "d-off",
          name: "off",
          amount: 200_000,
          memberId: "b",
          target: "account" as const,
          at: 8000,
          hsPushDir: "right" as const,
        },
      ],
      highSocietySettings: reOnSettings,
    });
    expect(reOnBaseline.seats[1]!.widthCm).toBe(onField.seats[1]!.widthCm);

    const reOnExpanded = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        baseDonor,
        {
          id: "d-new",
          name: "new",
          amount: 100_000,
          memberId: "b",
          target: "account" as const,
          at: 9500,
          hsPushDir: "right" as const,
          ...hsTerritoryOn,
        },
      ],
      highSocietySettings: reOnSettings,
    });
    expect(reOnExpanded.seats[1]!.widthCm).toBe(onField.seats[1]!.widthCm);
  });

  it("isHighSocietyReopen detects prior OFF cutoff", () => {
    expect(isHighSocietyReopen(normalizeHighSocietySettings({ enabled: false }))).toBe(false);
    expect(
      isHighSocietyReopen(normalizeHighSocietySettings({ enabled: false, territoryCutoffAt: 5000 }))
    ).toBe(true);
  });

  it("first ON does not create donationLinks (territory is log-only)", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
    ];
    const prev = normalizeHighSocietySettings({
      enabled: false,
      seatMemberIds: ["a", "b"],
      donationLinks: {},
    });
    const next = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: prev,
      nextSettings: normalizeHighSocietySettings({ ...prev, enabled: true }),
      members,
      now: 99_000,
    });
    expect(next.enabled).toBe(true);
    expect(next.donationLinks?.a).toBeUndefined();
    expect(next.memberWidthCm).toBeUndefined();
  });

  it("enabled toggle does not clear stored territory snapshot", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
    ];
    const prev = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
      memberWidthCm: { a: 80, b: 120 },
      memberTerritoryExpand: {
        a: { expandLeftCm: 0, expandRightCm: 0 },
        b: { expandLeftCm: 0, expandRightCm: 0 },
      },
    });
    const off = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: prev,
      nextSettings: normalizeHighSocietySettings({ ...prev, enabled: false }),
      members,
      now: 10_000,
    });
    expect(off.memberWidthCm).toEqual({ a: 80, b: 120 });
    const on = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: off,
      nextSettings: normalizeHighSocietySettings({ ...off, enabled: true }),
      members,
      now: 20_000,
    });
    expect(on.memberWidthCm).toEqual({ a: 80, b: 120 });
  });

  it("ignores member account balance — only qualifying donor rows expand territory", () => {
    const members = [
      { id: "a", name: "A", account: 600_000, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      fieldCm: 400,
      donationLinks: {
        a: { active: true, startedAt: 10_000 },
        b: { active: true, startedAt: 10_000 },
        c: { active: true, startedAt: 10_000 },
        d: { active: true, startedAt: 10_000 },
      },
    });
    const noDonors = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: settings,
    });
    expect(noDonors.seats.map((s) => s.widthCm)).toEqual([100, 100, 100, 100]);

    const oneSmall = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 10_000,
          memberId: "a",
          target: "account",
          at: 11_000,
          hsPushDir: "right",
          ...hsTerritoryOn,
        },
      ],
      highSocietySettings: settings,
    });
    expect(oneSmall.seats[0]!.widthCm).toBe(100);
    expect(oneSmall.seats[1]!.widthCm).toBe(100);
  });

  it("ineligible amount (15k) does not change territory won sum or break snapshot", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const linkAt = 1000;
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      fieldCm: 400,
      donationLinks: {
        a: { active: true, startedAt: linkAt },
        b: { active: true, startedAt: linkAt },
        c: { active: true, startedAt: linkAt },
        d: { active: true, startedAt: linkAt },
      },
      memberWidthCm: { b: 105, a: 95, c: 100, d: 100 },
      memberWidthDonationSnapshot: { b: 10_000, a: 0, c: 0, d: 0 },
    });
    const donors = [
      { id: "d1", name: "x", amount: 10_000, memberId: "b", at: 2000, ...hsTerritoryOn },
      { id: "d2", name: "y", amount: 15_000, memberId: "b", at: 3000, hsTerritoryExcluded: true },
    ];
    const field = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: settings,
    });
    expect(field.seats.find((s) => s.id === "b")!.widthCm).toBe(105);
    expect(field.seats.find((s) => s.id === "c")!.eliminated).toBe(false);
  });

  it("uses stored snapshot widths as-is (donations never expand territory)", () => {
    const members = [
      { id: "yoon", name: "윤시우", account: 0, toon: 25_000, operating: false },
      { id: "jaki", name: "자키", account: 0, toon: 0, operating: false },
      { id: "ga", name: "가여니", account: 0, toon: 0, operating: false },
      { id: "isia", name: "이시아", account: 0, toon: 200_000, operating: false },
    ];
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["yoon", "jaki", "ga", "isia"],
      fieldCm: 400,
      startCmPerMember: 100,
      donationLinks: {
        yoon: { active: true, startedAt: 1 },
        jaki: { active: true, startedAt: 1 },
        ga: { active: true, startedAt: 1 },
        isia: { active: true, startedAt: 1 },
      },
      memberWidthCm: { jaki: 100, yoon: 5, ga: 100, isia: 195 },
      memberWidthDonationSnapshot: { jaki: 0, yoon: 10_000, ga: 0, isia: 200_000 },
      memberTerritoryExpand: { yoon: { expandLeftCm: 0, expandRightCm: 5 } },
    });
    const donors = [
      { id: "d1", name: "a", amount: 10_000, memberId: "yoon", at: 2, ...hsTerritoryOn },
      { id: "d2", name: "b", amount: 15_000, memberId: "yoon", at: 3, hsTerritoryExcluded: true },
      { id: "d3", name: "c", amount: 200_000, memberId: "isia", at: 2, ...hsTerritoryOn },
    ];
    const field = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: settings,
    });
    expect(field.seats.find((s) => s.id === "ga")!.eliminated).toBe(false);
    expect(field.seats.find((s) => s.id === "yoon")!.widthCm).toBe(5);
    expect(field.seats.reduce((s, x) => s + x.widthCm, 0)).toBeCloseTo(400, 0);
  });

  it("donors never expand territory regardless of startedAt / 영토 ON", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const onAt = 50_000;
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      donationLinks: {
        b: { active: true, startedAt: onAt },
        a: { active: true, startedAt: onAt },
        c: { active: true, startedAt: onAt },
        d: { active: true, startedAt: onAt },
      },
    });
    const oldDonor = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-old",
          name: "과거",
          amount: 600_000,
          memberId: "b",
          target: "account",
          at: 1000,
          hsPushDir: "right",
        },
      ],
      highSocietySettings: settings,
    });
    expect(oldDonor.seats.map((s) => s.widthCm)).toEqual([300, 300, 300, 300]);

    const withoutToggle = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-new",
          name: "신규",
          amount: 10_000,
          memberId: "b",
          target: "account",
          at: onAt + 1,
          hsPushDir: "right",
        },
      ],
      highSocietySettings: settings,
    });
    expect(withoutToggle.seats[1]!.widthCm).toBe(300);

    const withToggle = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-new",
          name: "신규",
          amount: 10_000,
          memberId: "b",
          target: "account",
          at: onAt + 1,
          hsPushDir: "right",
          ...hsTerritoryOn,
        },
      ],
      highSocietySettings: settings,
    });
    expect(withToggle.seats[1]!.widthCm).toBe(300);
  });

  it("excludes donors with hsTerritoryExcluded from territory", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      fieldCm: 400,
    });
    const field = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 100_000,
          memberId: "b",
          target: "account",
          at: 1,
          hsPushDir: "right",
          hsTerritoryExcluded: true,
        },
      ],
      highSocietySettings: settings,
    });
    expect(field.seats.map((s) => s.widthCm)).toEqual([100, 100, 100, 100]);
  });

  it("markDonorsHsTerritoryExcluded flags all rows", () => {
    const donors = [
      { id: "d1", name: "A", amount: 1000, memberId: "a", at: 1 },
      { id: "d2", name: "B", amount: 2000, memberId: "b", at: 2, hsTerritoryExcluded: true },
    ];
    const marked = markDonorsHsTerritoryExcluded(donors, true);
    expect(marked.every((d) => d.hsTerritoryExcluded === true)).toBe(true);
  });

  it("mergeDonorRostersPreferFullest unions React empty with LS donors", () => {
    const ls = [
      { id: "d1", name: "A", amount: 5000, memberId: "m1", at: 100 },
      { id: "d2", name: "B", amount: 3000, memberId: "m2", at: 200 },
    ];
    const merged = mergeDonorRostersPreferFullest([], ls);
    expect(merged).toHaveLength(2);
    expect(merged.map((d) => d.id).sort()).toEqual(["d1", "d2"]);
  });

  it("mergeDonorRostersPreferFullest keeps rows without id (name|at|amount key)", () => {
    const react = [{ name: "익명", amount: 20_000, memberId: "m1", at: 500 } as const];
    const merged = mergeDonorRostersPreferFullest(react);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.amount).toBe(20_000);
  });

  it("resolveDonorsForHighSocietySettingsPatch on resetTerritory keeps donors unmarked", () => {
    const existing = [
      { id: "d1", name: "후원", amount: 50_000, memberId: "m1", at: 100 },
    ];
    const donors = resolveDonorsForHighSocietySettingsPatch({
      prevDonorsReact: existing,
      refDonors: [],
      lsDonors: [],
      resetTerritory: true,
      isFirstOn: false,
    });
    expect(donors).toHaveLength(1);
    expect(donors[0]!.amount).toBe(50_000);
    expect(donors[0]!.hsTerritoryExcluded).toBeUndefined();
  });

  it("shouldApplyDonorsForHighSocietySettingsPatch is false for empty list", () => {
    expect(shouldApplyDonorsForHighSocietySettingsPatch([])).toBe(false);
    expect(
      shouldApplyDonorsForHighSocietySettingsPatch([
        { id: "d1", name: "A", amount: 1000, memberId: "m1", at: 1 },
      ])
    ).toBe(true);
  });

  it("resolveDonorsForHighSocietySettingsPatch preserves donors on OFF when React is empty", () => {
    const ls = [{ id: "d1", name: "A", amount: 8000, memberId: "m1", at: 100 }];
    const donors = resolveDonorsForHighSocietySettingsPatch({
      prevDonorsReact: [],
      refDonors: [],
      lsDonors: ls,
      resetTerritory: false,
      isFirstOn: false,
    });
    expect(donors).toHaveLength(1);
    expect(donors[0]!.amount).toBe(8000);
    expect(donors[0]!.hsTerritoryExcluded).toBeUndefined();
  });

  it("resolveDonorsForHighSocietySettingsPatch preserves donors on territory pause when ref holds rows", () => {
    const ref = [{ id: "d1", name: "A", amount: 12_000, memberId: "m1", at: 50 }];
    const donors = resolveDonorsForHighSocietySettingsPatch({
      prevDonorsReact: [],
      refDonors: ref,
      lsDonors: [],
      resetTerritory: false,
      isFirstOn: false,
    });
    expect(donors).toHaveLength(1);
    expect(donors[0]!.amount).toBe(12_000);
  });

  it("resolveDonorsForHighSocietySettingsPatch never marks hsTerritoryExcluded", () => {
    const existing = [
      { id: "d1", name: "A", amount: 5000, memberId: "m1", at: 100 },
    ];
    const off = resolveDonorsForHighSocietySettingsPatch({
      prevDonorsReact: existing,
      refDonors: existing,
      lsDonors: existing,
      resetTerritory: false,
      isFirstOn: false,
    });
    expect(off[0]!.hsTerritoryExcluded).toBeUndefined();
    const firstOn = resolveDonorsForHighSocietySettingsPatch({
      prevDonorsReact: existing,
      refDonors: existing,
      lsDonors: existing,
      resetTerritory: false,
      isFirstOn: true,
    });
    expect(firstOn[0]!.hsTerritoryExcluded).toBeUndefined();
  });

  it("shouldPersistDonorsForHighSocietySettingsPatch is always false (territory log only)", () => {
    expect(
      shouldPersistDonorsForHighSocietySettingsPatch({ resetTerritory: false, isFirstOn: false })
    ).toBe(false);
    expect(
      shouldPersistDonorsForHighSocietySettingsPatch({ resetTerritory: true, isFirstOn: false })
    ).toBe(false);
    expect(
      shouldPersistDonorsForHighSocietySettingsPatch({ resetTerritory: false, isFirstOn: true })
    ).toBe(false);
  });

  it("shouldMarkDonorsLocallyForHighSocietySettingsPatch is always false", () => {
    expect(
      shouldMarkDonorsLocallyForHighSocietySettingsPatch({ resetTerritory: false, isFirstOn: false })
    ).toBe(false);
    expect(
      shouldMarkDonorsLocallyForHighSocietySettingsPatch({ resetTerritory: true, isFirstOn: false })
    ).toBe(false);
    expect(
      shouldMarkDonorsLocallyForHighSocietySettingsPatch({ resetTerritory: false, isFirstOn: true })
    ).toBe(false);
  });

  it("markDonorsForHighSocietyTerritoryRoundBump marks OFF on round increase only", () => {
    const donors = [
      { id: "d1", name: "후원", amount: 50_000, memberId: "b", target: "account" as const, at: 100 },
    ];
    expect(
      markDonorsForHighSocietyTerritoryRoundBump({ prevRound: 2, nextRound: 2, donors })
    ).toBeNull();
    const marked = markDonorsForHighSocietyTerritoryRoundBump({
      prevRound: 2,
      nextRound: 3,
      donors,
    });
    expect(marked?.[0]?.hsTerritoryExcluded).toBe(true);
    expect(marked?.[0]?.amount).toBe(50_000);
  });

  it("resolveDonationSyncModeForHighSocietySettingsChange does not steal mealBattle", () => {
    expect(
      resolveDonationSyncModeForHighSocietySettingsChange({
        turningOn: false,
        turningOff: true,
        prevMode: "highSociety",
      })
    ).toBe("highSociety");
    expect(
      resolveDonationSyncModeForHighSocietySettingsChange({
        turningOn: true,
        turningOff: false,
        prevMode: "mealBattle",
      })
    ).toBe("mealBattle");
    expect(
      resolveDonationSyncModeForHighSocietySettingsChange({
        turningOn: false,
        turningOff: false,
        prevMode: "sigMatch",
      })
    ).toBe("sigMatch");
  });

  it("resetTerritory donor patch keeps member totals after sync", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 50_000, toon: 0, operating: false },
    ];
    const donors = resolveDonorsForHighSocietySettingsPatch({
      prevDonorsReact: [
        { id: "d1", name: "후원", amount: 50_000, memberId: "b", target: "account" as const, at: 100 },
      ],
      refDonors: [],
      lsDonors: [],
      resetTerritory: true,
      isFirstOn: false,
    });
    expect(donors[0]?.hsTerritoryExcluded).toBeUndefined();
    expect(shouldApplyDonorsForHighSocietySettingsPatch(donors)).toBe(true);
    const synced = syncMemberTotalsFromDonors({
      members,
      donors,
      highSocietySettings: normalizeHighSocietySettings({ enabled: true }),
    } as import("@/types").AppState);
    expect(synced.members?.find((m) => m.id === "b")?.account).toBe(50_000);
  });

  it("resetTerritory bumps round and startedAt only (donors unchanged in field when no new donations)", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const donors = [
      {
        id: "d1",
        name: "후원",
        amount: 100_000,
        memberId: "b",
        target: "account" as const,
        at: 6000,
        hsPushDir: "right" as const,
        ...hsTerritoryOn,
      },
    ];
    const prev = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      round: 2,
      donationLinks: { b: { active: true, startedAt: 5000 } },
      memberWidthCm: { a: 250, b: 350, c: 300, d: 300 },
      memberWidthDonationSnapshot: { a: 0, b: 0, c: 0, d: 0 },
    });
    const resetAt = 80_000;
    const next = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: prev,
      nextSettings: prev,
      members,
      resetTerritory: true,
      now: resetAt,
    });
    expect(next.round).toBe(3);
    expect(next.donationLinks?.b?.startedAt).toBe(5000);
    expect(next.memberWidthCm).toBeUndefined();
    const beforeReset = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: prev,
    });
    const afterReset = buildHighSocietyFieldFromAppState({
      members,
      donors: markDonorsHsTerritoryExcluded(donors, true),
      highSocietySettings: next,
    });
    expect(beforeReset.seats[1]!.widthCm).toBe(350);
    expect(afterReset.seats[1]!.widthCm).toBe(300);
    expect(donors).toHaveLength(1);
    expect(donors[0]!.amount).toBe(100_000);
  });

  it("applyHighSocietyAdminPatchToState resetTerritory clears territoryLogs and equalizes widths", async () => {
    const { applyHighSocietyAdminPatchToState } = await import("@/lib/admin-high-society-settings-patch");
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const donors = [
      { id: "d1", name: "후원", amount: 50_000, memberId: "b", target: "account" as const, at: 100 },
    ];
    const prev = {
      members,
      donors,
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["a", "b", "c", "d"],
        round: 1,
        memberWidthCm: { a: 200, b: 400, c: 300, d: 300 },
      }),
      territoryLogs: [createTerritoryLog("b", 1, 100, { pushDir: "right" })],
      updatedAt: 1,
    } as import("@/types").AppState;
    const next = applyHighSocietyAdminPatchToState(prev, { resetTerritory: true });
    expect(next.territoryLogs).toEqual([]);
    expect(Number(next.highSocietySettings?.territoryLogsResetAt)).toBeGreaterThan(0);
    expect(next.donors?.[0]?.hsTerritoryExcluded).toBeUndefined();
    expect(next.donors?.[0]?.amount).toBe(50_000);
    const field = buildHighSocietyFieldFromAppState(next);
    expect(field.seats.every((s) => s.widthCm === 300)).toBe(true);
  });

  it("applyHighSocietyAdminPatchToState 자리 변경은 기록부를 비우지 않는다", async () => {
    const { applyHighSocietyAdminPatchToState } = await import("@/lib/admin-high-society-settings-patch");
    const members = [
      { id: "a", name: "퐁이", account: 0, toon: 0, operating: false },
      { id: "b", name: "곽호경", account: 0, toon: 0, operating: false },
      { id: "c", name: "명실이", account: 0, toon: 0, operating: false },
    ];
    const log = createTerritoryLog("b", 1, 185, { pushDir: "right", now: 2000 });
    const prev = {
      members,
      donors: [],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["a", "b", "c"],
        seatMemberIdsManual: true,
        memberWidthCm: { a: 15, b: 285, c: 100 },
      }),
      territoryLogs: [log],
      updatedAt: 1,
    } as import("@/types").AppState;
    const next = applyHighSocietyAdminPatchToState(prev, {
      seatMemberIds: ["b", "a", "c"],
      seatMemberIdsManual: true,
    });
    expect(next.territoryLogs?.map((l) => l.id)).toEqual([log.id]);
    expect(Number(next.highSocietySettings?.territoryLogsResetAt || 0)).toBe(0);
    expect(next.highSocietySettings?.seatMemberIds).toEqual(["b", "a", "c"]);
  });

  it("자리만 바꾸면 탈락 cm 은 그대로이고 퐁이가 되살아나지 않는다", async () => {
    const { applyHighSocietyAdminPatchToState } = await import("@/lib/admin-high-society-settings-patch");
    const members = [
      { id: "yuri", name: "유리", account: 0, toon: 0, operating: false },
      { id: "pong", name: "퐁이", account: 0, toon: 0, operating: false },
      { id: "reze", name: "레제", account: 0, toon: 0, operating: false },
      { id: "yeong", name: "영실이", account: 0, toon: 0, operating: false },
      { id: "jaki", name: "자기", account: 0, toon: 0, operating: false },
      { id: "gwak", name: "곽호경", account: 0, toon: 0, operating: false },
    ];
    const widths = { yuri: 20, pong: 0, reze: 0, yeong: 400, jaki: 180, gwak: 0 };
    const prev = {
      members,
      donors: [],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["yuri", "pong", "reze", "yeong", "jaki", "gwak"],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 600,
        memberWidthCm: widths,
      }),
      territoryLogs: [
        createTerritoryLog("yeong", 1, 600, { pushDir: "split", now: 1_000 }),
        createTerritoryLog("pong", 1, 5, { pushDir: "split", now: 2_000 }),
      ],
      updatedAt: 1,
    } as import("@/types").AppState;
    const moved = applyHighSocietyAdminPatchToState(prev, {
      seatMemberIds: ["pong", "reze", "yeong", "yuri", "jaki", "gwak"],
      seatMemberIdsManual: true,
    });
    expect(moved.highSocietySettings?.memberWidthCm).toMatchObject(widths);
    const autoAll = applyHighSocietyAdminPatchToState(prev, {
      seatMemberIds: [],
      seatMemberIdsManual: false,
    });
    expect(autoAll.highSocietySettings?.memberWidthCm).toMatchObject(widths);
    expect(autoAll.highSocietySettings?.memberWidthCm?.pong).toBe(0);
    expect(autoAll.highSocietySettings?.memberWidthCm?.yeong).toBe(400);
  });

  it("자리만 바꾸면 대기 직전 게이지 스냅샷을 버린다", async () => {
    const { applyHighSocietyAdminPatchToState } = await import("@/lib/admin-high-society-settings-patch");
    const members = [
      { id: "yuri", name: "유리", account: 0, toon: 0, operating: false },
      { id: "pong", name: "퐁이", account: 0, toon: 0, operating: false },
      { id: "yeong", name: "영실이", account: 0, toon: 0, operating: false },
    ];
    const prev = {
      members,
      donors: [],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["yuri", "pong", "yeong"],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 300,
        memberWidthCm: { yuri: 20, pong: 0, yeong: 280 },
        pendingEndEntryMemberIds: ["pong"],
        pendingEndEntryBoardCm: { yuri: 20, pong: 0, yeong: 280 },
      }),
      territoryLogs: [],
      updatedAt: 1,
    } as import("@/types").AppState;
    const next = applyHighSocietyAdminPatchToState(prev, {
      seatMemberIds: ["pong", "yuri", "yeong"],
      seatMemberIdsManual: true,
    });
    expect(next.highSocietySettings?.memberWidthCm?.yuri).toBe(20);
    expect(next.highSocietySettings?.memberWidthCm?.pong).toBe(0);
    expect(next.highSocietySettings?.memberWidthCm?.yeong).toBe(280);
    expect(next.highSocietySettings?.pendingEndEntryBoardCm).toBeUndefined();
  });

  it("자동(전원)은 끝 선택 대기를 이웃 영토에서 빼서 되살리지 않는다", async () => {
    const { applyHighSocietyAdminPatchToState } = await import("@/lib/admin-high-society-settings-patch");
    const members = [
      { id: "pong", name: "퐁이", account: 0, toon: 0, operating: false },
      { id: "reze", name: "레제", account: 0, toon: 0, operating: false },
      { id: "yeong", name: "영실이", account: 0, toon: 0, operating: false },
      { id: "yuri", name: "유리", account: 0, toon: 0, operating: false },
      { id: "jaki", name: "자기", account: 0, toon: 0, operating: false },
      { id: "gwak", name: "곽호경", account: 0, toon: 0, operating: false },
    ];
    const prev = {
      members,
      donors: [],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["yuri", "pong", "reze", "yeong", "jaki", "gwak"],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 600,
        memberWidthCm: { yuri: 20, pong: 5, reze: 0, yeong: 400, jaki: 175, gwak: 0 },
        pendingEndEntryMemberIds: ["pong"],
      }),
      territoryLogs: [],
      updatedAt: 1,
    } as import("@/types").AppState;
    const next = applyHighSocietyAdminPatchToState(prev, {
      seatMemberIds: [],
      seatMemberIdsManual: false,
    });
    expect(next.highSocietySettings?.pendingEndEntryMemberIds).toContain("pong");
    expect(next.highSocietySettings?.memberWidthCm?.pong).toBe(5);
    expect(next.highSocietySettings?.memberWidthCm?.yeong).toBe(400);
    expect(next.highSocietySettings?.memberWidthCm?.yuri).toBe(20);
  });

  it("저장된 cm가 없으면 기록부는 다시 깔지 않는다", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const oldLog = createTerritoryLog("b", 1, 120, { now: 1_000, pushDir: "right" });
    const newLog = createTerritoryLog("b", 1, 20, { now: 60_000, pushDir: "right" });
    const state = {
      members,
      donors: [],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["a", "b", "c", "d"],
        startCmPerMember: 100,
        territoryLogsResetAt: 50_000,
        memberWidthCm: { a: 100, b: 100, c: 100, d: 100 },
      }),
      territoryLogs: [oldLog, newLog],
    } as import("@/types").AppState;
    const field = buildHighSocietyFieldFromAppState(state);
    expect(field.seats.find((s) => s.id === "b")?.widthCm).toBe(100);
    expect(field.seats.find((s) => s.id === "c")?.widthCm).toBe(100);
    expect(field.seats.find((s) => s.id === "a")?.widthCm).toBe(100);
  });

  it("mergeHighSocietySettingsPreferBaseline does not restore snapshot after territory reset", () => {
    const baseline = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
      round: 1,
      fieldCm: 400,
      memberWidthCm: { a: 360, b: 40 },
    });
    const afterReset = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
      round: 2,
      fieldCm: 400,
      territoryLogsResetAt: 50_000,
    });
    const merged = mergeHighSocietySettingsPreferBaseline(baseline, afterReset);
    expect(merged.round).toBe(2);
    expect(merged.territoryLogsResetAt).toBe(50_000);
    expect(merged.memberWidthCm).toBeUndefined();
  });

  it("honors explicit single-seat list without falling back to all members", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
    ];
    const { seats, playerCount } = buildHighSocietyFieldFromMembers(members, {
      seatMemberIds: ["b"],
    });
    expect(playerCount).toBe(1);
    expect(seats.map((s) => s.name)).toEqual(["B"]);
  });

  it("empty seatMemberIds falls back to all non-operating members", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "op", name: "운영", account: 0, toon: 0, operating: true },
    ];
    const { seats } = buildHighSocietyFieldFromMembers(members, { seatMemberIds: [] });
    expect(seats.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("manual empty seatMemberIds keeps no seats (does not fall back to roster)", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
    ];
    expect(
      resolveHighSocietySeatMembers(members, { seatMemberIds: [], seatMemberIdsManual: true })
    ).toEqual([]);
    const { seats, playerCount } = buildHighSocietyFieldFromMembers(members, {
      seatMemberIds: [],
      seatMemberIdsManual: true,
    });
    expect(playerCount).toBe(0);
    expect(seats).toEqual([]);
  });

  it("manual subset excludes removed members without roster fallback", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
    ];
    const { seats } = buildHighSocietyFieldFromMembers(members, { seatMemberIds: ["a", "c"] });
    expect(seats.map((s) => s.id)).toEqual(["a", "c"]);
    expect(isHighSocietySeatSelectionManual({ seatMemberIds: ["a", "c"] })).toBe(true);
  });

  it("appendHighSocietySeatMemberId supports re-add after remove", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
    ];
    const removed = { seatMemberIds: ["a"], seatMemberIdsManual: true as const };
    expect(resolveHighSocietySeatMembers(members, removed).map((s) => s.id)).toEqual(["a"]);
    const reAddedIds = appendHighSocietySeatMemberId(
      resolveHighSocietySeatMemberIdsForEdit(removed, members),
      "b"
    );
    const reAdded = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: normalizeHighSocietySettings({
        enabled: true,
        ...removed,
        donationLinks: {
          a: { active: true, startedAt: 1000 },
          b: { active: false, startedAt: 1000 },
        },
      }),
      nextSettings: normalizeHighSocietySettings({
        enabled: false,
        seatMemberIds: reAddedIds,
        seatMemberIdsManual: true,
      }),
      members,
    });
    expect(resolveHighSocietySeatMembers(members, reAdded).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("detectHighSocietyGrowFlashSeatIds", () => {
  it("flashes only the seat whose expand pressure grew (not neighbor recovery)", () => {
    const prev = {
      ji3: { left: 0, right: 50 },
      ji5: { left: 0, right: 10 },
    };
    /** 지3: →→← 로 바꿔 left 증가, right 감소. 지5는 압력만 줄고 expand 불변 */
    const { grownIds, nextPrev } = detectHighSocietyGrowFlashSeatIds(
      [
        { id: "ji3", expandLeftCm: 50, expandRightCm: 0 },
        { id: "ji5", expandLeftCm: 0, expandRightCm: 10 },
      ],
      prev
    );
    expect(grownIds).toEqual(["ji3"]);
    expect(nextPrev.ji3).toEqual({ left: 50, right: 0 });
    expect(nextPrev.ji5).toEqual({ left: 0, right: 10 });
  });

  it("does not flash on first paint (no prev)", () => {
    const { grownIds } = detectHighSocietyGrowFlashSeatIds(
      [{ id: "a", expandLeftCm: 20, expandRightCm: 0 }],
      {}
    );
    expect(grownIds).toEqual([]);
  });
});

describe("high-society fx settings", () => {
  it("defaults production-safe effects to ON (벽 구분선·영토 가장자리), motion effects to OFF", () => {
    const fx = defaultHighSocietyFxSettings();
    expect(fx).toEqual({
      /** ✅ 2026-09-13 벽 사라짐 Bug Fix 기본값 상향:
       *  frontier=true (영토 가장자리 장식) + contestedEdge=true (진한 칸 사이 벽 구분선) 은
       *  디폴트로 켜서 신규 유저·settings 리셋 후에도 벽 구분선이 항상 잘 보이도록.
       *  모션 효과(growFlash) · 화살표 전용(arrowBlade) · 강한 외곽선(strongOutline) 은 성능/시각 영향으로 OFF 유지.
       */
      frontier: true,
      growFlash: false,
      contestedEdge: true,
      arrowBlade: false,
      strongOutline: false,
    });
    expect(normalizeHighSocietyFxSettings(undefined)).toEqual(fx);
    expect(normalizeHighSocietyFxSettings({})).toEqual(fx);
    expect(normalizeHighSocietySettings(null).fx).toEqual(fx);
  });

  it("respects explicit false, otherwise falls back to new defaults (contestedEdge·frontier ON)", () => {
    expect(
      normalizeHighSocietyFxSettings({
        frontier: true,            // 명시적 true → 유지
        growFlash: false,          // 명시적 false → 유지
        // contestedEdge: undefined → 이제 기본값 true 유지 (Fix #normalize undefined 처리)
        // arrowBlade, strongOutline: undefined → 기본값 false 유지
      })
    ).toEqual({
      frontier: true,
      growFlash: false,
      contestedEdge: true,       // ✅ 2026-09-13 Fix: undefined → 기본값 true (벽 구분선 기본 ON)
      arrowBlade: false,
      strongOutline: false,
    });
  });

  it("round-trips hsFx preview param", () => {
    const param = highSocietyFxToHsFxParam({
      frontier: true,
      growFlash: false,
      contestedEdge: true,
      arrowBlade: false,
      strongOutline: true,
    });
    expect(param).toBe("10101");
    expect(parseHighSocietyFxFromHsFxParam(param)).toEqual({
      frontier: true,
      growFlash: false,
      contestedEdge: true,
      arrowBlade: false,
      strongOutline: true,
    });
  });
});

describe("high-society startCmPerMember persistence", () => {
  it("keeps saved startCmPerMember when OFF with no seats", () => {
    const settings = normalizeHighSocietySettings({
      enabled: false,
      seatMemberIds: [],
      fieldCm: 1200,
      startCmPerMember: 400,
    });
    expect(settings.startCmPerMember).toBe(400);
    expect(resolveHighSocietyStartCmPerMember(settings, 4)).toBe(400);
    expect(resolveHighSocietyEffectiveFieldCm(settings, 4)).toBe(1600);
  });

  it("syncs fieldCm from startCmPerMember on normalize", () => {
    const settings = normalizeHighSocietySettings({
      fieldCm: 1200,
      startCmPerMember: 500,
      seatMemberIds: ["a", "b", "c"],
    });
    expect(settings.startCmPerMember).toBe(500);
    expect(settings.fieldCm).toBe(1500);
  });

  it("buildHighSocietyFieldFromAppState preserves effective field when OFF", () => {
    const settings = normalizeHighSocietySettings({
      enabled: false,
      seatMemberIds: [],
      startCmPerMember: 450,
      fieldCm: 1200,
    });
    const state = {
      members: [
        { id: "a", name: "A", account: 0, toon: 0, operating: false },
        { id: "b", name: "B", account: 0, toon: 0, operating: false },
      ],
      donors: [],
      highSocietySettings: settings,
    };
    const field = buildHighSocietyFieldFromAppState(state);
    expect(field.settings.startCmPerMember).toBe(450);
    expect(field.settings.fieldCm).toBe(900);
    expect(field.fieldCm).toBe(900);
  });

  it("reconcileHighSocietyFieldDimensions grows field when seat count increases", () => {
    const base = normalizeHighSocietySettings({
      startCmPerMember: 400,
      seatMemberIds: [],
    });
    expect(base.fieldCm).toBe(1600);
    const reconciled = reconcileHighSocietyFieldDimensions(base, 2);
    expect(reconciled.startCmPerMember).toBe(400);
    expect(reconciled.fieldCm).toBe(800);
  });

  it("startCmPerMemberOverride scales field with seat count", () => {
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: [],
      startCmPerMember: 300,
      fieldCm: 1200,
    });
    const state = {
      members: [
        { id: "a", name: "A", account: 0, toon: 0, operating: false },
        { id: "b", name: "B", account: 0, toon: 0, operating: false },
        { id: "c", name: "C", account: 0, toon: 0, operating: false },
        { id: "d", name: "D", account: 0, toon: 0, operating: false },
      ],
      donors: [],
      highSocietySettings: settings,
    };
    const withoutOverride = buildHighSocietyFieldFromAppState(state);
    expect(withoutOverride.seats[0]!.widthCm).toBe(300);
    const withOverride = buildHighSocietyFieldFromAppState(state, { startCmPerMemberOverride: 400 });
    expect(withOverride.seats[0]!.widthCm).toBe(400);
    expect(withOverride.fieldCm).toBe(1600);
  });
});

describe("highSociety regression guards", () => {
  it("isDefaultLikeHighSocietySettings detects fresh defaults", () => {
    expect(isDefaultLikeHighSocietySettings(defaultHighSocietySettings())).toBe(true);
    expect(
      isDefaultLikeHighSocietySettings(
        normalizeHighSocietySettings({
          enabled: false,
          seatMemberIds: [],
          round: 1,
        })
      )
    ).toBe(true);
  });

  it("isMeaningfulHighSocietySettings detects active territory state", () => {
    expect(
      isMeaningfulHighSocietySettings(
        normalizeHighSocietySettings({ enabled: true, seatMemberIds: ["a", "b"] })
      )
    ).toBe(true);
    expect(
      isMeaningfulHighSocietySettings(
        normalizeHighSocietySettings({ enabled: false, territoryCutoffAt: Date.now() })
      )
    ).toBe(true);
    expect(isMeaningfulHighSocietySettings(normalizeHighSocietySettings({ enabled: false }))).toBe(
      false
    );
  });

  it("shouldBlockHighSocietyRegression blocks default patch over meaningful base", () => {
    const base = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      round: 2,
      fieldCm: 1600,
      startCmPerMember: 400,
    });
    expect(shouldBlockHighSocietyRegression(base, defaultHighSocietySettings())).toBe(true);
    expect(
      shouldBlockHighSocietyRegression(
        base,
        normalizeHighSocietySettings({ enabled: false, territoryCutoffAt: Date.now() })
      )
    ).toBe(false);
  });

  it("mergeHighSocietySettingsPreferBaseline keeps territory snapshot on stale wire", () => {
    const baseline = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
      fieldCm: 400,
      memberWidthCm: { a: 220, b: 180 },
      memberWidthDonationSnapshot: { a: 100000, b: 80000 },
    });
    const staleWire = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
      fieldCm: 400,
    });
    const merged = mergeHighSocietySettingsPreferBaseline(baseline, staleWire);
    expect(merged.memberWidthCm).toEqual({ a: 220, b: 180 });
    expect(merged.memberWidthDonationSnapshot).toEqual({ a: 100000, b: 80000 });
  });

  it("OBS last-good은 한 명이 다 먹은 판을 균등 100cm stale 스냅샷으로 되돌리지 않는다", () => {
    const ids = ["pong", "yuri", "jaki", "gwak", "yeong", "reze"];
    const baseline = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ids,
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      fieldCm: 600,
      memberWidthCm: { pong: 0, yuri: 0, jaki: 600, gwak: 0, yeong: 0, reze: 0 },
      territorySnapshotEpochAt: 2_000,
    });
    const staleEqual = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ids,
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      fieldCm: 600,
      memberWidthCm: Object.fromEntries(ids.map((id) => [id, 100])),
      territorySnapshotEpochAt: 9_000,
    });
    const merged = mergeHighSocietySettingsPreferBaseline(baseline, staleEqual);
    expect(merged.memberWidthCm?.jaki).toBe(600);
    expect(merged.memberWidthCm?.pong).toBe(0);
    expect(Object.values(merged.memberWidthCm || {}).filter((w) => Number(w) > 0)).toHaveLength(1);
  });

  it("OBS last-good은 혼자 남은 땅을 일부만 있는 stale 스냅샷으로 줄이지 않는다", () => {
    const ids = ["pong", "yuri", "jaki", "gwak", "yeong", "reze"];
    const baseline = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ids,
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      fieldCm: 600,
      memberWidthCm: { pong: 0, yuri: 0, jaki: 600, gwak: 0, yeong: 0, reze: 0 },
      territorySnapshotEpochAt: 2_000,
    });
    const stalePartial = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ids,
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      fieldCm: 600,
      memberWidthCm: { pong: 0, yuri: 200, jaki: 200, gwak: 0, yeong: 200, reze: 0 },
      territorySnapshotEpochAt: 9_000,
    });
    const mergedSplit = mergeHighSocietySettingsPreferBaseline(baseline, stalePartial);
    expect(mergedSplit.memberWidthCm?.jaki).toBe(600);
    const staleWeaker = normalizeHighSocietySettings({
      ...stalePartial,
      memberWidthCm: { pong: 0, yuri: 0, jaki: 400, gwak: 0, yeong: 0, reze: 0 },
    });
    const mergedWeaker = mergeHighSocietySettingsPreferBaseline(baseline, staleWeaker);
    expect(mergedWeaker.memberWidthCm?.jaki).toBe(600);
    const liveGrow = normalizeHighSocietySettings({
      ...stalePartial,
      memberWidthCm: { pong: 0, yuri: 0, jaki: 600, gwak: 0, yeong: 0, reze: 0 },
    });
    const fromStart = mergeHighSocietySettingsPreferBaseline(
      normalizeHighSocietySettings({
        ...baseline,
        memberWidthCm: Object.fromEntries(ids.map((id) => [id, 100])),
      }),
      liveGrow
    );
    expect(fromStart.memberWidthCm?.jaki).toBe(600);
    const pendingOne = normalizeHighSocietySettings({
      ...baseline,
      pendingEndEntryMemberIds: ["pong"],
      memberWidthCm: { pong: 10, yuri: 0, jaki: 590, gwak: 0, yeong: 0, reze: 0 },
      territorySnapshotEpochAt: 9_000,
    });
    const mergedPending = mergeHighSocietySettingsPreferBaseline(baseline, pendingOne);
    expect(mergedPending.memberWidthCm?.jaki).toBe(590);
    expect(mergedPending.memberWidthCm?.pong).toBe(10);
    const startCmReset = normalizeHighSocietySettings({
      ...stalePartial,
      startCmPerMember: 200,
      fieldCm: 1200,
      memberWidthCm: Object.fromEntries(ids.map((id) => [id, 200])),
    });
    const mergedStartCm = mergeHighSocietySettingsPreferBaseline(baseline, startCmReset);
    expect(mergedStartCm.memberWidthCm?.jaki).toBe(200);
    expect(mergedStartCm.startCmPerMember).toBe(200);
  });

  it("가운데 끝 선택 대기는 stale 전체 스냅샷이 전원을 한 번에 되살리지 않는다", () => {
    const baseline = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["reze", "gwak", "pong", "yeong", "yuri", "jaki"],
      fieldCm: 600,
      startCmPerMember: 100,
      pendingEndEntryMemberIds: ["gwak", "pong", "yeong", "yuri"],
      memberWidthCm: { reze: 55, gwak: 45, pong: 45, yeong: 0, yuri: 0, jaki: 5 },
    });
    const incomingAlive = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["reze", "gwak", "pong", "yeong", "yuri", "jaki"],
      fieldCm: 600,
      startCmPerMember: 100,
      memberWidthCm: { reze: 55, gwak: 45, pong: 45, yeong: 175, yuri: 275, jaki: 5 },
    });
    expect(
      pendingEndEntryIdsAfterIncomingSettings(baseline, incomingAlive)
    ).toEqual(["gwak", "pong", "yeong", "yuri"]);
    const merged = mergeHighSocietySettingsPreferBaseline(baseline, incomingAlive);
    expect(merged.pendingEndEntryMemberIds).toEqual(["gwak", "pong", "yeong", "yuri"]);
    expect(merged.memberWidthCm).toEqual(baseline.memberWidthCm);
    const wiped = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: baseline,
      nextSettings: incomingAlive,
      members: ["reze", "gwak", "pong", "yeong", "yuri", "jaki"].map((id) => ({
        id,
        name: id,
        account: 0,
        toon: 0,
        operating: false,
      })),
      now: 5_000,
    });
    expect(wiped.pendingEndEntryMemberIds).toEqual(["gwak", "pong", "yeong", "yuri"]);
  });

  it("자리·epoch 가 바뀐 새 판은 last-good 대기와 옛 cm를 붙잡지 않는다", () => {
    const baseline = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["pong", "yeong", "jaki", "yuri", "gwak"],
      fieldCm: 600,
      startCmPerMember: 100,
      pendingEndEntryMemberIds: ["yeong", "jaki"],
      pendingEndEntryBoardCm: { pong: 5, yeong: 235, jaki: 340, yuri: 15, gwak: 5 },
      memberWidthCm: { pong: 5, yeong: 235, jaki: 340, yuri: 15, gwak: 5 },
      territorySnapshotEpochAt: 1_000,
    });
    const incoming = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["jaki", "gwak", "pong", "reze", "yeong", "yuri"],
      fieldCm: 600,
      startCmPerMember: 100,
      memberWidthCm: { jaki: 5, gwak: 0, pong: 585, reze: 0, yeong: 0, yuri: 10 },
      territorySnapshotEpochAt: 2_000,
    });
    const merged = mergeHighSocietySettingsPreferBaseline(baseline, incoming);
    expect(merged.pendingEndEntryMemberIds ?? []).toEqual([]);
    expect(merged.memberWidthCm).toEqual(incoming.memberWidthCm);
    expect(merged.seatMemberIds).toEqual(incoming.seatMemberIds);
  });

  it("자리가 바뀐 판은 대기가 남아 있어도 last-good 게이지를 붙잡지 않는다", () => {
    const baseline = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["yuri", "pong", "reze", "yeong", "jaki", "gwak"],
      fieldCm: 600,
      startCmPerMember: 100,
      pendingEndEntryMemberIds: ["pong"],
      pendingEndEntryBoardCm: { yuri: 20, pong: 0, reze: 0, yeong: 400, jaki: 180, gwak: 0 },
      memberWidthCm: { yuri: 20, pong: 0, reze: 0, yeong: 400, jaki: 180, gwak: 0 },
      territorySnapshotEpochAt: 1_000,
    });
    const incoming = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["pong", "reze", "yeong", "yuri", "jaki", "gwak"],
      fieldCm: 600,
      startCmPerMember: 100,
      pendingEndEntryMemberIds: ["pong"],
      memberWidthCm: { yuri: 20, pong: 0, reze: 0, yeong: 400, jaki: 180, gwak: 0 },
      territorySnapshotEpochAt: 2_000,
    });
    const merged = mergeHighSocietySettingsPreferBaseline(baseline, incoming);
    expect(merged.seatMemberIds).toEqual(incoming.seatMemberIds);
    expect(merged.memberWidthCm).toEqual(incoming.memberWidthCm);
    expect(merged.pendingEndEntryBoardCm).toBeUndefined();
  });

  it("상류사회 현재 설정은 더 큰 updatedAt 이 와도 그대로 저장한다", () => {
    const local = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
      memberWidthCm: { a: 80, b: 120 },
    });
    const incoming = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["b", "a"],
      memberWidthCm: { a: 80, b: 120 },
    });
    expect(
      shouldKeepLocalHighSocietySettings({
        local,
        incoming,
      })
    ).toBe(true);
    expect(
      shouldKeepLocalHighSocietySettings({
        local: defaultHighSocietySettings(),
        incoming,
      })
    ).toBe(false);
    expect(
      shouldKeepLocalHighSocietySettings({
        local,
        incoming: normalizeHighSocietySettings({ ...incoming, round: 2 }),
      })
    ).toBe(false);
    expect(
      shouldKeepLocalHighSocietySettings({
        local,
        incoming: defaultHighSocietySettings(),
      })
    ).toBe(true);
  });

  it("mergeHighSocietySettingsPreferBaseline blocks full default regression", () => {
    const baseline = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      round: 2,
      fieldCm: 1600,
    });
    expect(mergeHighSocietySettingsPreferBaseline(baseline, defaultHighSocietySettings())).toEqual(
      baseline
    );
  });

  it("isSeatMemberIdsReorderOnly detects pure reorder", () => {
    expect(isSeatMemberIdsReorderOnly(["a", "b", "c"], ["b", "a", "c"])).toBe(true);
    expect(isSeatMemberIdsReorderOnly(["a", "b"], ["a", "b"])).toBe(false);
    expect(isSeatMemberIdsReorderOnly(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(
      isSeatMemberIdsReorderOnly([], ["b", "a"], ["a", "b"])
    ).toBe(true);
    expect(effectiveHighSocietySeatOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(effectiveHighSocietySeatOrder(["b", "a"], ["x", "y"])).toEqual(["b", "a"]);
  });

  it("seat reorder preserves each member widthCm (not slot inheritance)", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const linkStarted = 1000;
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      startCmPerMember: 300,
      memberWidthCm: { a: 325, b: 275, c: 300, d: 300 },
      memberWidthDonationSnapshot: { a: 0, b: 0, c: 0, d: 0 },
      donationLinks: {
        a: { active: true, startedAt: linkStarted },
        b: { active: true, startedAt: linkStarted },
        c: { active: true, startedAt: linkStarted },
        d: { active: true, startedAt: linkStarted },
      },
    });
    const donors: Array<{ memberId: string; amount: number; at: number }> = [];
    const before = buildHighSocietyFieldFromAppState({ members, donors, highSocietySettings: settings });
    const widthA = before.seats.find((s) => s.id === "a")!.widthCm;
    const widthB = before.seats.find((s) => s.id === "b")!.widthCm;
    expect(widthA).toBeGreaterThan(widthB + 5);

    const reordered = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settings,
      nextSettings: normalizeHighSocietySettings({
        ...settings,
        seatMemberIds: ["b", "a", "c", "d"],
      }),
      members,
      donors,
    });
    expect(reordered.memberWidthCm?.a).toBeCloseTo(widthA, 0);
    expect(reordered.memberWidthCm?.b).toBeCloseTo(widthB, 0);

    const after = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: reordered,
    });
    expect(after.seats.find((s) => s.id === "a")!.widthCm).toBeCloseTo(widthA, 0);
    expect(after.seats.find((s) => s.id === "b")!.widthCm).toBeCloseTo(widthB, 0);
  });

  it("double seat reorder keeps member widths (no slot physics drift)", () => {
    const members = [
      { id: "joy", name: "죠이", account: 0, toon: 0, operating: false },
      { id: "woo", name: "최우주", account: 0, toon: 0, operating: false },
    ];
    const linkStarted = 1000;
    let settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["joy", "woo"],
      startCmPerMember: 200,
      fieldCm: 400,
      memberWidthCm: { joy: 325, woo: 275 },
      memberWidthDonationSnapshot: { joy: 0, woo: 0 },
      donationLinks: {
        joy: { active: true, startedAt: linkStarted },
        woo: { active: true, startedAt: linkStarted },
      },
    });
    const donors: Array<{ memberId: string; amount: number; at: number }> = [];
    const baseline = buildHighSocietyFieldFromAppState({ members, donors, highSocietySettings: settings });
    const widthJoy = baseline.seats.find((s) => s.id === "joy")!.widthCm;
    const widthWoo = baseline.seats.find((s) => s.id === "woo")!.widthCm;
    expect(widthJoy).toBeGreaterThan(widthWoo);

    settings = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settings,
      nextSettings: normalizeHighSocietySettings({ ...settings, seatMemberIds: ["woo", "joy"] }),
      members,
      donors,
    });
    const swapped = buildHighSocietyFieldFromAppState({ members, donors, highSocietySettings: settings });
    expect(swapped.seats.find((s) => s.id === "joy")!.widthCm).toBeCloseTo(widthJoy, 0);
    expect(swapped.seats.find((s) => s.id === "woo")!.widthCm).toBeCloseTo(widthWoo, 0);
    expect(swapped.seats.filter((s) => !s.eliminated).length).toBe(2);

    settings = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settings,
      nextSettings: normalizeHighSocietySettings({ ...settings, seatMemberIds: ["joy", "woo"] }),
      members,
      donors,
    });
    const back = buildHighSocietyFieldFromAppState({ members, donors, highSocietySettings: settings });
    expect(back.seats.find((s) => s.id === "joy")!.widthCm).toBeCloseTo(widthJoy, 0);
    expect(back.seats.find((s) => s.id === "woo")!.widthCm).toBeCloseTo(widthWoo, 0);
    expect(back.seats.filter((s) => !s.eliminated).length).toBe(2);
  });

  it("re-added seat keeps donation link startedAt after removal", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
    ];
    const startedAt = 5000;
    const prev = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
      donationLinks: {
        a: { active: true, startedAt },
        b: { active: true, startedAt },
      },
    });
    const removed = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: prev,
      nextSettings: normalizeHighSocietySettings({ ...prev, seatMemberIds: ["a"] }),
      members,
      donors: [{ memberId: "b", amount: 10_000, at: 6000 }],
    });
    expect(removed.seatMemberIds).toEqual(["a"]);
    expect(removed.donationLinks?.b?.startedAt).toBe(startedAt);

    const reAdded = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: removed,
      nextSettings: normalizeHighSocietySettings({ ...prev, seatMemberIds: ["a", "b"] }),
      members,
      donors: [{ memberId: "b", amount: 10_000, at: 6000 }],
    });
    expect(reAdded.seatMemberIds).toEqual(["a", "b"]);
    expect(reAdded.donationLinks?.b?.startedAt).toBe(startedAt);
  });
});

describe("0cm eliminated member re-entry", () => {
  const members = [
    { id: "jaki", name: "자기", account: 0, toon: 0, operating: false },
    { id: "jisu", name: "지수", account: 0, toon: 0, operating: false },
    { id: "subin", name: "수빈", account: 0, toon: 0, operating: false },
  ];
  const linkAt = 1000;
  const baseSettings = normalizeHighSocietySettings({
    enabled: true,
    seatMemberIds: ["jaki", "jisu", "subin"],
    startCmPerMember: 100,
    fieldCm: 300,
    donationLinks: {
      jaki: { active: true, startedAt: linkAt },
      jisu: { active: true, startedAt: linkAt },
      subin: { active: true, startedAt: linkAt },
    },
  });

  it("0cm 멤버가 영토 기록으로 확장하면 한 번에 땅이 생긴다", () => {
    const settings = normalizeHighSocietySettings({
      ...baseSettings,
      seatMemberIds: ["jaki", "subin", "jisu"],
    });
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: settings,
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("jaki", 1, 100, { pushDir: "right", now: 1_000 })
    );
    expect(buildHighSocietyFieldFromAppState(state).seats.find((s) => s.id === "subin")!.widthCm).toBe(0);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("subin", 1, 20, { pushDir: "right", now: 2_000 })
    );
    const field = buildHighSocietyFieldFromAppState(state);
    const subin = field.seats.find((s) => s.id === "subin")!;
    const jisu = field.seats.find((s) => s.id === "jisu")!;
    expect(subin.eliminated).toBe(false);
    expect(subin.widthCm).toBe(20);
    expect(jisu.widthCm).toBe(80);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds ?? []).not.toContain("subin");
    expect(field.seats.map((s) => s.id)).toEqual(["jaki", "jisu", "subin"]);
  });

  it("OBS·관리자 게이지는 끝 선택 전에 가운데 땅을 붙이지 않는다", () => {
    const settings = normalizeHighSocietySettings({
      ...baseSettings,
      seatMemberIds: ["jaki", "subin", "jisu"],
    });
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: settings,
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("jaki", 1, 100, { pushDir: "right", now: 1_000 })
    );
    const before = buildHighSocietyFieldFromAppState(state);
    expect(before.seats.find((s) => s.id === "subin")!.widthCm).toBe(0);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("subin", 1, 20, { pushDir: "split", now: 2_000 })
    );
    const live = buildHighSocietyFieldFromAppState(state);
    expect(live.seats.find((s) => s.id === "subin")!.widthCm).toBe(20);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("subin");
    const overlay = resolveHighSocietyOverlayGaugeSeats(
      live.seats,
      state.highSocietySettings
    );
    expect(overlay.map((s) => s.id)).toEqual(["jaki", "subin", "jisu"]);
    expect(overlay.find((s) => s.id === "subin")!.widthCm).toBe(0);
    expect(overlay.find((s) => s.id === "jaki")!.widthCm).toBe(
      before.seats.find((s) => s.id === "jaki")!.widthCm
    );
    expect(overlay.find((s) => s.id === "jisu")!.widthCm).toBe(
      before.seats.find((s) => s.id === "jisu")!.widthCm
    );
  });

  it("대기 스냅샷이 없어도 이미 그린 게이지 모양을 유지한다", () => {
    const prev = [
      { id: "a", name: "A", color: "#111111", widthCm: 100, eliminated: false },
      { id: "b", name: "B", color: "#222222", widthCm: 0, eliminated: true },
      { id: "c", name: "C", color: "#333333", widthCm: 200, eliminated: false },
    ] as import("@/lib/high-society").HighSocietySeat[];
    const next = [
      { id: "a", name: "에이", color: "#abcdef", widthCm: 50, eliminated: false },
      { id: "b", name: "비", color: "#fedcba", widthCm: 300, eliminated: false },
      { id: "c", name: "씨", color: "#010101", widthCm: 50, eliminated: false },
    ] as import("@/lib/high-society").HighSocietySeat[];
    const held = holdHighSocietyOverlayGaugeIfPending(
      next,
      prev,
      normalizeHighSocietySettings({
        pendingEndEntryMemberIds: ["b"],
      })
    );
    expect(held.map((s) => s.widthCm)).toEqual([100, 0, 200]);
    expect(held.find((s) => s.id === "a")!.name).toBe("에이");
    expect(held.find((s) => s.id === "a")!.color).toBe("#abcdef");
    expect(held.find((s) => s.id === "b")!.widthCm).toBe(0);
  });

  it("옛 대기 스냅샷에 땅이 있으면 OBS는 새 저장 cm를 그린다", () => {
    const live = [
      { id: "jaki", widthCm: 5, eliminated: false },
      { id: "gwak", widthCm: 0, eliminated: true },
      { id: "pong", widthCm: 585, eliminated: false },
      { id: "reze", widthCm: 0, eliminated: true },
      { id: "yeong", widthCm: 0, eliminated: true },
      { id: "yuri", widthCm: 10, eliminated: false },
    ] as import("@/lib/high-society").HighSocietySeat[];
    const overlay = resolveHighSocietyOverlayGaugeSeats(
      live,
      normalizeHighSocietySettings({
        pendingEndEntryMemberIds: ["yeong", "jaki"],
        pendingEndEntryBoardCm: { pong: 5, yeong: 235, jaki: 340, yuri: 15, gwak: 5 },
      })
    );
    expect(overlay.find((s) => s.id === "pong")!.widthCm).toBe(585);
    expect(overlay.find((s) => s.id === "jaki")!.widthCm).toBe(0);
    expect(overlay.find((s) => s.id === "yuri")!.widthCm).toBe(10);
  });

  it("좌석 순서가 바뀌면 이미 그린 게이지를 붙잡지 않는다", () => {
    const prev = [
      { id: "pong", widthCm: 5, eliminated: false },
      { id: "yeong", widthCm: 235, eliminated: false },
      { id: "jaki", widthCm: 340, eliminated: false },
    ] as import("@/lib/high-society").HighSocietySeat[];
    const next = [
      { id: "jaki", widthCm: 5, eliminated: false },
      { id: "pong", widthCm: 585, eliminated: false },
      { id: "yeong", widthCm: 0, eliminated: true },
    ] as import("@/lib/high-society").HighSocietySeat[];
    const held = holdHighSocietyOverlayGaugeIfPending(
      next,
      prev,
      normalizeHighSocietySettings({ pendingEndEntryMemberIds: ["jaki"] })
    );
    expect(held).toBe(next);
  });

  it("개인전 가운데 +20 무방향은 좌우 양분", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["a", "b", "c", "d"],
        startCmPerMember: 100,
        fieldCm: 400,
        matchMode: "individual",
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 20));
    const field = buildHighSocietyFieldFromAppState(state);
    expect(field.seats.find((s) => s.id === "a")!.widthCm).toBe(90);
    expect(field.seats.find((s) => s.id === "b")!.widthCm).toBe(120);
    expect(field.seats.find((s) => s.id === "c")!.widthCm).toBe(90);
    expect(field.seats.find((s) => s.id === "d")!.widthCm).toBe(100);
    expect(field.seats.filter((s) => !s.eliminated).map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("0cm 인원은 땅이 생기기 전엔 탈락이고, +왼쪽이면 왼쪽 끝으로만 재진입", () => {
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        ...baseSettings,
        seatMemberIds: ["jaki", "subin", "jisu"],
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("jaki", 1, 100, { pushDir: "right", now: 1_000 })
    );
    const zeroField = buildHighSocietyFieldFromAppState(state);
    expect(zeroField.seats.find((s) => s.id === "subin")!.eliminated).toBe(true);
    expect(zeroField.seats.find((s) => s.id === "subin")!.widthCm).toBe(0);
    expect(zeroField.seats.filter((s) => !s.eliminated).map((s) => s.id)).toEqual(["jaki", "jisu"]);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("subin", 1, 20, { pushDir: "left", now: 2_000 })
    );
    const field = buildHighSocietyFieldFromAppState(state);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds ?? []).not.toContain("subin");
    expect(field.seats.map((s) => s.id)).toEqual(["subin", "jaki", "jisu"]);
    expect(field.seats.find((s) => s.id === "subin")!.widthCm).toBe(20);
    expect(field.seats.find((s) => s.id === "jaki")!.widthCm).toBe(180);
  });

  it("re-entry uses hsPushDir left vs right on middle seat expand", () => {
    const middleSettings = normalizeHighSocietySettings({
      ...baseSettings,
      seatMemberIds: ["jaki", "subin", "jisu"],
    });
    const donorsBase = [
      { id: "d-jaki", name: "a", amount: 210_000, memberId: "jaki", at: 2000, ...hsTerritoryOn },
      { id: "d-jisu", name: "b", amount: 200_000, memberId: "jisu", at: 2000, ...hsTerritoryOn },
      {
        id: "d-subin",
        name: "c",
        amount: 100_000,
        memberId: "subin",
        at: 3000,
        ...hsTerritoryOn,
      },
    ];
    const snap = {
      memberWidthCm: { jaki: 105, jisu: 195, subin: 0 },
      memberWidthDonationSnapshot: { jaki: 210_000, jisu: 200_000, subin: 100_000 },
      memberTerritoryExpand: {
        jaki: { expandLeftCm: 0, expandRightCm: 105 },
        jisu: { expandLeftCm: 195, expandRightCm: 0 },
        subin: { expandLeftCm: 0, expandRightCm: 50 },
      },
    };
    const pushRight = buildHighSocietyFieldFromAppState({
      members,
      donors: donorsBase.map((d) =>
        d.id === "d-subin" ? { ...d, hsPushDir: "right" as const } : d
      ),
      highSocietySettings: normalizeHighSocietySettings({ ...middleSettings, ...snap }),
    });
    const pushLeft = buildHighSocietyFieldFromAppState({
      members,
      donors: donorsBase.map((d) =>
        d.id === "d-subin" ? { ...d, hsPushDir: "left" as const } : d
      ),
      highSocietySettings: normalizeHighSocietySettings({
        ...middleSettings,
        ...snap,
        memberTerritoryExpand: {
          ...snap.memberTerritoryExpand,
          subin: { expandLeftCm: 50, expandRightCm: 0 },
        },
      }),
    });
    const subinRight = pushRight.seats.find((s) => s.id === "subin")!;
    const subinLeft = pushLeft.seats.find((s) => s.id === "subin")!;
    expect(subinRight.expandRightCm).toBe(50);
    expect(subinRight.expandLeftCm).toBe(0);
    expect(subinLeft.expandLeftCm).toBe(50);
    expect(subinLeft.expandRightCm).toBe(0);
  });

  it("땅이 다시 생기면 왼쪽 또는 오른쪽을 고르기 전에는 대기하고, 고른 뒤에만 그 끝에 앉는다", () => {
    const members = [
      { id: "jaki", name: "자기", account: 0, toon: 0, operating: false },
      { id: "subin", name: "수빈", account: 0, toon: 0, operating: false },
      { id: "jisu", name: "지수", account: 0, toon: 0, operating: false },
    ];
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["jaki", "subin", "jisu"],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 300,
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("jaki", 1, 100, { pushDir: "right", now: 1_000 })
    );
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("subin", 1, 20, { pushDir: "split", now: 2_000 })
    );
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("subin");
    expect(state.highSocietySettings?.seatMemberIds).toEqual(["jaki", "subin", "jisu"]);

    const placed = placeHighSocietyPendingEndMember(
      state.highSocietySettings?.seatMemberIds || [],
      "subin",
      "left"
    );
    expect(placed).toEqual(["subin", "jaki", "jisu"]);
    const afterChoice = normalizeHighSocietySettings({
      ...state.highSocietySettings,
      seatMemberIds: placed,
      pendingEndEntryMemberIds: [],
      territorySnapshotEpochAt: 3_000,
    });
    const shown = buildHighSocietyFieldFromAppState({
      ...state,
      highSocietySettings: afterChoice,
    });
    expect(shown.seats.map((s) => s.id)[0]).toBe("subin");
    expect(shown.seats.find((s) => s.id === "subin")!.widthCm).toBeGreaterThan(0);
    const movedAgain = moveHighSocietySeatMemberToIndex(placed, "subin", 1);
    expect(movedAgain).toEqual(["jaki", "subin", "jisu"]);
  });

  it("끝으로 고르면 그 끝의 이웃에게서 가져오고, 빼면 대기에서 빠진다", () => {
    const members = [
      { id: "jaki", name: "자기", account: 0, toon: 0, operating: false },
      { id: "subin", name: "수빈", account: 0, toon: 0, operating: false },
      { id: "jisu", name: "지수", account: 0, toon: 0, operating: false },
    ];
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["jaki", "subin", "jisu"],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 300,
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("jaki", 1, 100, { pushDir: "right", now: 1_000 })
    );
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("subin", 1, 20, { pushDir: "split", now: 2_000 })
    );
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("subin");
    const removed = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: state.highSocietySettings!,
      nextSettings: normalizeHighSocietySettings({
        ...state.highSocietySettings,
        seatMemberIds: ["jaki", "jisu"],
        seatMemberIdsManual: true,
      }),
      members,
      territoryLogs: state.territoryLogs,
      now: 2_500,
    });
    expect(removed.pendingEndEntryMemberIds ?? []).not.toContain("subin");
    expect(removed.memberWidthCm?.jaki).toBe(200);
    expect(removed.memberWidthCm?.jisu).toBe(100);
    const readded = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: removed,
      nextSettings: normalizeHighSocietySettings({
        ...removed,
        seatMemberIds: ["jaki", "jisu", "subin"],
        seatMemberIdsManual: true,
      }),
      members,
      territoryLogs: state.territoryLogs,
      now: 2_600,
    });
    expect(readded.pendingEndEntryMemberIds ?? []).not.toContain("subin");
    expect(readded.memberWidthCm?.subin).toBe(100);

    let fresh = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["jaki", "subin", "jisu"],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 300,
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    fresh = appendTerritoryLogToAppState(
      fresh,
      createTerritoryLog("jaki", 1, 100, { pushDir: "right", now: 1_000 })
    );
    fresh = appendTerritoryLogToAppState(
      fresh,
      createTerritoryLog("subin", 1, 20, { pushDir: "split", now: 2_000 })
    );
    const nextIds = placeHighSocietyPendingEndMember(
      fresh.highSocietySettings?.seatMemberIds || [],
      "subin",
      "right"
    );
    const placed = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: fresh.highSocietySettings!,
      nextSettings: normalizeHighSocietySettings({
        ...fresh.highSocietySettings,
        seatMemberIds: nextIds,
        seatMemberIdsManual: true,
        pendingEndEntryMemberIds: [],
      }),
      members,
      territoryLogs: fresh.territoryLogs,
      now: 3_000,
    });
    const shown = buildHighSocietyFieldFromAppState({
      ...fresh,
      highSocietySettings: placed,
    });
    expect(shown.seats.map((seat) => seat.id)).toEqual(["jaki", "jisu", "subin"]);
    expect(shown.seats.find((seat) => seat.id === "jaki")!.widthCm).toBe(200);
    expect(shown.seats.find((seat) => seat.id === "jisu")!.widthCm).toBe(80);
    expect(shown.seats.find((seat) => seat.id === "subin")!.widthCm).toBe(20);
  });

  it("끝 선택 대기 중인 자키의 5cm는 다른 사람의 끝 선택으로 0이 되지 않는다", () => {
    const members = ["gwak", "jaki", "yeong", "yuri", "reze", "pong"].map((id) => ({
      id,
      name: id,
      account: 0,
      toon: 0,
      operating: false,
    }));
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: members.map((m) => m.id),
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 600,
        memberWidthCm: { jaki: 0, gwak: 73, yeong: 0, yuri: 355, reze: 73, pong: 95 },
        territorySnapshotEpochAt: 1_000,
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("jaki", 1, 5, { pushDir: "split", now: 2_000 })
    );
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("jaki");
    expect(state.highSocietySettings?.memberWidthCm?.jaki).toBe(5);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("yeong", 1, 10, { pushDir: "split", now: 3_000 })
    );
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toEqual(
      expect.arrayContaining(["jaki", "yeong"])
    );
    expect(state.highSocietySettings?.memberWidthCm?.jaki).toBe(5);
    const nextIds = moveHighSocietySeatMemberToIndex(
      state.highSocietySettings?.seatMemberIds || [],
      "yeong",
      5
    );
    const placed = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: state.highSocietySettings!,
      nextSettings: normalizeHighSocietySettings({
        ...state.highSocietySettings,
        seatMemberIds: nextIds,
        seatMemberIdsManual: true,
        pendingEndEntryMemberIds: (state.highSocietySettings?.pendingEndEntryMemberIds || []).filter(
          (id) => id !== "yeong"
        ),
      }),
      members,
      territoryLogs: state.territoryLogs,
      now: 4_000,
    });
    expect(placed.pendingEndEntryMemberIds).toContain("jaki");
    expect(placed.memberWidthCm?.jaki).toBe(5);
    expect(placed.memberWidthCm?.yeong).toBe(10);
    const shown = buildHighSocietyFieldFromAppState({
      ...state,
      highSocietySettings: placed,
    });
    expect(shown.seats.find((seat) => seat.id === "jaki")!.widthCm).toBe(5);
    expect(shown.seats.find((seat) => seat.id === "yeong")!.widthCm).toBe(10);
  });

  it("가운데 탈락을 살릴 때 이미 살아난 끝 영토를 다시 0으로 만들지 않는다", () => {
    const ids = ["jaki", "gwak", "yeong", "reze", "yuri", "pong"] as const;
    const members = ids.map((id) => ({
      id,
      name: id,
      account: 0,
      toon: 0,
      operating: false,
    }));
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: [...ids],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 600,
        matchMode: "individual",
        territorySnapshotEpochAt: 1_000,
        memberWidthCm: {
          jaki: 100,
          gwak: 100,
          yeong: 300,
          reze: 0,
          yuri: 100,
          pong: 0,
        },
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("pong", 1, 5, { pushDir: "split", now: 2_000 })
    );
    expect(state.highSocietySettings?.memberWidthCm?.pong).toBe(5);
    expect(state.highSocietySettings?.memberWidthCm?.yuri).toBe(95);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds || []).not.toContain("pong");
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("reze", 1, 5, { pushDir: "split", now: 3_000 })
    );
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("reze");
    expect(state.highSocietySettings?.seatMemberIds).toEqual([...ids]);
    expect(state.highSocietySettings?.memberWidthCm?.reze).toBe(5);
    expect(state.highSocietySettings?.memberWidthCm?.pong).toBe(5);
    expect(state.highSocietySettings?.memberWidthCm?.yuri).toBe(95);
    expect(state.highSocietySettings?.memberWidthCm?.jaki).toBe(100);
    const nextIds = moveHighSocietySeatMemberToIndex(
      state.highSocietySettings?.seatMemberIds || [],
      "reze",
      0
    );
    const placed = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: state.highSocietySettings!,
      nextSettings: normalizeHighSocietySettings({
        ...state.highSocietySettings,
        seatMemberIds: nextIds,
        seatMemberIdsManual: true,
        pendingEndEntryMemberIds: (state.highSocietySettings?.pendingEndEntryMemberIds || []).filter(
          (id) => id !== "reze"
        ),
      }),
      members,
      territoryLogs: state.territoryLogs,
      now: 4_000,
    });
    const shown = buildHighSocietyFieldFromAppState({
      ...state,
      highSocietySettings: placed,
    });
    expect(shown.seats.map((seat) => seat.id)[0]).toBe("reze");
    expect(shown.seats.find((seat) => seat.id === "reze")!.widthCm).toBe(5);
    expect(shown.seats.find((seat) => seat.id === "pong")!.widthCm).toBe(5);
    expect(shown.seats.find((seat) => seat.id === "jaki")!.widthCm).toBe(95);
    expect(shown.seats.find((seat) => seat.id === "yuri")!.widthCm).toBe(95);
    expect(shown.seats.reduce((sum, seat) => sum + seat.widthCm, 0)).toBe(600);
  });

  it("좌석을 고정한 뒤 기록은 한 번만 반영된다", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
    ];
    const state = appendTerritoryLogToAppState(
      {
        members,
        donors: [],
        highSocietySettings: normalizeHighSocietySettings({
          enabled: true,
          seatMemberIds: ["a", "b"],
          seatMemberIdsManual: true,
          startCmPerMember: 100,
          fieldCm: 200,
          memberWidthCm: { a: 150, b: 50 },
          territorySnapshotEpochAt: 5_000,
        }),
        territoryLogs: [],
      } as import("@/types").AppState,
      createTerritoryLog("b", 1, 20, { pushDir: "left", now: 6_000 })
    );
    const once = buildHighSocietyFieldFromAppState(state);
    const twice = buildHighSocietyFieldFromAppState(state);
    expect(once.seats.find((seat) => seat.id === "a")!.widthCm).toBe(130);
    expect(once.seats.find((seat) => seat.id === "b")!.widthCm).toBe(70);
    expect(twice.seats.find((seat) => seat.id === "b")!.widthCm).toBe(70);
  });

  it("땅이 없는 멤버는 왼쪽 끝과 오른쪽 끝에만 다시 앉는다", () => {
    const ids = ["yuri", "gwak", "young", "jaki", "pong", "reze"];
    expect(eliminatedSeatEndIndex(0, 6)).toBe(0);
    expect(eliminatedSeatEndIndex(5, 6)).toBe(5);
    expect(eliminatedSeatEndIndex(1, 6)).toBe(0);
    expect(eliminatedSeatEndIndex(2, 6)).toBe(0);
    expect(eliminatedSeatEndIndex(3, 6)).toBe(5);
    expect(eliminatedSeatEndIndex(4, 6)).toBe(5);
    expect(moveHighSocietySeatMemberToIndex(ids, "jaki", 2, { endsOnly: true })).toEqual([
      "jaki",
      "yuri",
      "gwak",
      "young",
      "pong",
      "reze",
    ]);
    expect(moveHighSocietySeatMemberToIndex(ids, "reze", 0, { endsOnly: true })).toEqual([
      "reze",
      "yuri",
      "gwak",
      "young",
      "jaki",
      "pong",
    ]);
    expect(moveHighSocietySeatMemberToIndex(ids, "yuri", 3)).toEqual([
      "gwak",
      "young",
      "jaki",
      "yuri",
      "pong",
      "reze",
    ]);
    expect(placeHighSocietyPendingEndMember(ids, "pong", "right")).toEqual([
      "yuri",
      "gwak",
      "young",
      "jaki",
      "reze",
      "pong",
    ]);
  });

  it("5번 자리 0cm가 오른쪽으로 앉으면 맨 오른쪽 벽으로 간다", async () => {
    const { applyHighSocietyAdminPatchToState } = await import("@/lib/admin-high-society-settings-patch");
    const members = [
      { id: "pong", name: "퐁이", account: 0, toon: 0, operating: false },
      { id: "yuri", name: "유리", account: 0, toon: 0, operating: false },
      { id: "jaki", name: "자기", account: 0, toon: 0, operating: false },
      { id: "gwak", name: "곽호경", account: 0, toon: 0, operating: false },
      { id: "yeong", name: "영실이", account: 0, toon: 0, operating: false },
      { id: "reze", name: "레제", account: 0, toon: 0, operating: false },
    ];
    const ids = ["pong", "yuri", "jaki", "gwak", "yeong", "reze"];
    let state = {
      members,
      donors: [],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ids,
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 600,
        memberWidthCm: { pong: 10, yuri: 190, jaki: 380, gwak: 0, yeong: 0, reze: 20 },
        territorySnapshotEpochAt: 1_000,
      }),
      territoryLogs: [],
      updatedAt: 1,
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("yeong", 1, 10, { pushDir: "right", now: 2_000 })
    );
    expect(state.highSocietySettings?.seatMemberIds?.at(-1)).toBe("yeong");
    expect(state.highSocietySettings?.pendingEndEntryMemberIds ?? []).not.toContain("yeong");
    expect(state.highSocietySettings?.memberWidthCm?.yeong).toBe(10);
    expect(state.highSocietySettings?.memberWidthCm?.reze).toBe(10);

    let pendingState = {
      members,
      donors: [],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ids,
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 600,
        memberWidthCm: { pong: 10, yuri: 190, jaki: 380, gwak: 0, yeong: 10, reze: 20 },
        pendingEndEntryMemberIds: ["yeong"],
        territorySnapshotEpochAt: 1_000,
      }),
      territoryLogs: [],
      updatedAt: 1,
    } as import("@/types").AppState;
    const placed = applyHighSocietyAdminPatchToState(pendingState, {
      seatMemberIds: ids,
      seatMemberIdsManual: true,
      pendingEndEntryMemberIds: [],
    });
    expect(placed.highSocietySettings?.seatMemberIds?.at(-1)).toBe("yeong");
    expect(placed.highSocietySettings?.pendingEndEntryMemberIds ?? []).not.toContain("yeong");
    expect(placed.highSocietySettings?.memberWidthCm?.yeong).toBe(10);
    expect(placed.highSocietySettings?.memberWidthCm?.reze).toBe(10);
  });

  it("0cm가 왼쪽 벽으로 들어오면 같은 쪽 작은 땅은 밀고 큰 땅에서 가져온다", async () => {
    const { applyHighSocietyAdminPatchToState } = await import("@/lib/admin-high-society-settings-patch");
    const members = [
      { id: "yuri", name: "유리", account: 0, toon: 0, operating: false },
      { id: "jaki", name: "자기", account: 0, toon: 0, operating: false },
      { id: "gwak", name: "곽호경", account: 0, toon: 0, operating: false },
      { id: "reze", name: "레제", account: 0, toon: 0, operating: false },
      { id: "pong", name: "퐁이", account: 0, toon: 0, operating: false },
      { id: "yeong", name: "영실이", account: 0, toon: 0, operating: false },
    ];
    const prev = {
      members,
      donors: [],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["yuri", "jaki", "gwak", "reze", "pong", "yeong"],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 600,
        memberWidthCm: { yuri: 10, jaki: 580, gwak: 0, reze: 0, pong: 10, yeong: 10 },
        pendingEndEntryMemberIds: ["yeong"],
        territorySnapshotEpochAt: 1_000,
      }),
      territoryLogs: [],
      updatedAt: 1,
    } as import("@/types").AppState;
    const nextIds = placeHighSocietyPendingEndMember(
      prev.highSocietySettings?.seatMemberIds || [],
      "yeong",
      "left"
    );
    const placed = applyHighSocietyAdminPatchToState(prev, {
      seatMemberIds: nextIds,
      seatMemberIdsManual: true,
      pendingEndEntryMemberIds: [],
    });
    expect(nextIds[0]).toBe("yeong");
    expect(placed.highSocietySettings?.memberWidthCm?.yeong).toBe(10);
    expect(placed.highSocietySettings?.memberWidthCm?.yuri).toBe(10);
    expect(placed.highSocietySettings?.memberWidthCm?.jaki).toBe(570);
    expect(placed.highSocietySettings?.memberWidthCm?.pong).toBe(10);
  });

  it("insertHighSocietySeatMemberIdAt places member at chosen index", () => {
    expect(insertHighSocietySeatMemberIdAt(["a", "b", "c"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(insertHighSocietySeatMemberIdAt(["a", "b", "c"], "d", 2)).toEqual(["a", "b", "d", "c"]);
    expect(insertHighSocietySeatMemberIdAt(["a", "b", "c"], "d", 99)).toEqual(["a", "b", "c", "d"]);
    expect(appendHighSocietySeatMemberId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("0cm 멤버를 옮겨도 옆 사람 영토는 초기화되지 않는다", () => {
    const members = [
      { id: "jaki", name: "자기", account: 0, toon: 0, operating: false },
      { id: "jisu", name: "지수", account: 0, toon: 0, operating: false },
      { id: "subin", name: "수빈", account: 0, toon: 0, operating: false },
    ];
    const logs = [createTerritoryLog("jaki", 1, 100, { pushDir: "right", now: 1_000 })];
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["jaki", "subin", "jisu"],
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      fieldCm: 300,
    });
    const beforeState = appendTerritoryLogToAppState(
      {
        members,
        donors: [],
        highSocietySettings: settings,
        territoryLogs: [],
      } as import("@/types").AppState,
      logs[0]!
    );
    const before = buildHighSocietyFieldFromAppState(beforeState);
    expect(before.seats.find((s) => s.id === "subin")!.widthCm).toBe(0);
    const widthById = Object.fromEntries(before.seats.map((s) => [s.id, s.widthCm]));

    const moved = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: beforeState.highSocietySettings!,
      nextSettings: normalizeHighSocietySettings({
        ...beforeState.highSocietySettings,
        seatMemberIds: ["jaki", "jisu", "subin"],
        seatMemberIdsManual: true,
      }),
      members,
      territoryLogs: beforeState.territoryLogs,
      now: 5_000,
    });
    const after = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: moved,
      territoryLogs: logs,
    });
    expect(after.seats.map((s) => s.id)).toEqual(["jaki", "jisu", "subin"]);
    expect(after.seats.find((s) => s.id === "subin")!.widthCm).toBe(0);
    expect(after.seats.find((s) => s.id === "jaki")!.widthCm).toBe(widthById.jaki);
    expect(after.seats.find((s) => s.id === "jisu")!.widthCm).toBe(widthById.jisu);
    expect(logs).toHaveLength(1);
  });

  it("0cm seat layout change preserves other member widths (no equal-split reset)", () => {
    const members = [
      { id: "jaki", name: "자기", account: 0, toon: 0, operating: false },
      { id: "jisu", name: "지수", account: 0, toon: 0, operating: false },
      { id: "subin", name: "수빈", account: 0, toon: 0, operating: false },
    ];
    const linkAt = 1000;
    let settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["jaki", "jisu", "subin"],
      startCmPerMember: 100,
      fieldCm: 300,
      memberWidthCm: { jaki: 105, jisu: 195, subin: 0 },
      memberWidthDonationSnapshot: { jaki: 0, jisu: 0, subin: 0 },
      donationLinks: {
        jaki: { active: true, startedAt: linkAt },
        jisu: { active: true, startedAt: linkAt },
        subin: { active: true, startedAt: linkAt },
      },
    });
    const donors: Array<{ id: string; name: string; amount: number; memberId: string; at: number }> = [];
    const baseline = buildHighSocietyFieldFromAppState({ members, donors, highSocietySettings: settings });
    const widthJaki = baseline.seats.find((s) => s.id === "jaki")!.widthCm;
    const widthJisu = baseline.seats.find((s) => s.id === "jisu")!.widthCm;
    expect(baseline.seats.find((s) => s.id === "subin")!.widthCm).toBe(0);
    expect(widthJaki).toBeGreaterThan(widthJisu * 0.5);

    settings = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settings,
      nextSettings: normalizeHighSocietySettings({
        ...settings,
        seatMemberIds: ["jaki", "subin", "jisu"],
        seatMemberIdsManual: true,
      }),
      members,
      donors,
    });
    expect(settings.memberWidthCm?.jaki).toBeCloseTo(widthJaki, 0);
    expect(settings.memberWidthCm?.jisu).toBeCloseTo(widthJisu, 0);
    expect(settings.memberWidthCm?.subin).toBe(0);

    const moved = buildHighSocietyFieldFromAppState({ members, donors, highSocietySettings: settings });
    expect(moved.seats.find((s) => s.id === "jaki")!.widthCm).toBeCloseTo(widthJaki, 0);
    expect(moved.seats.find((s) => s.id === "jisu")!.widthCm).toBeCloseTo(widthJisu, 0);
    expect(moved.seats.find((s) => s.id === "subin")!.widthCm).toBe(0);
    expect(moved.seats.map((s) => s.id)).toEqual(["jaki", "subin", "jisu"]);
  });

  it("sync after 0cm member moves to end does not equal-split reset survivors", () => {
    const members = [
      { id: "jaki", name: "자키", account: 0, toon: 0, operating: false },
      { id: "jisu", name: "지수", account: 0, toon: 0, operating: false },
      { id: "subin", name: "수빈", account: 0, toon: 0, operating: false },
    ];
    const linkAt = 1000;
    let settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["jaki", "jisu", "subin"],
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      fieldCm: 300,
      territoryUpdateMode: "realtime",
      memberWidthCm: { jaki: 105, jisu: 195, subin: 0 },
      memberWidthDonationSnapshot: { jaki: 0, jisu: 0, subin: 0 },
      donationLinks: {
        jaki: { active: true, startedAt: linkAt },
        jisu: { active: true, startedAt: linkAt },
        subin: { active: true, startedAt: linkAt },
      },
    });
    const donors: Array<{ id: string; name: string; amount: number; memberId: string; at: number }> = [];
    const baseline = buildHighSocietyFieldFromAppState({ members, donors, highSocietySettings: settings });
    const widthJaki = baseline.seats.find((s) => s.id === "jaki")!.widthCm;
    const widthJisu = baseline.seats.find((s) => s.id === "jisu")!.widthCm;
    expect(baseline.seats.find((s) => s.id === "subin")!.widthCm).toBe(0);

    settings = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settings,
      nextSettings: normalizeHighSocietySettings({
        ...settings,
        seatMemberIds: ["jaki", "subin", "jisu"],
      }),
      members,
      donors,
    });
    settings = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settings,
      nextSettings: normalizeHighSocietySettings({
        ...settings,
        seatMemberIds: ["jaki", "jisu", "subin"],
      }),
      members,
      donors,
    });

    const state = { members, donors, highSocietySettings: settings, territoryLogs: [] };
    const synced = syncHighSocietyMemberWidthSnapshotInState(state as never);
    const field = buildHighSocietyFieldFromAppState(synced as never);
    expect(field.seats.find((s) => s.id === "jaki")!.widthCm).toBeCloseTo(widthJaki, 0);
    expect(field.seats.find((s) => s.id === "jisu")!.widthCm).toBeCloseTo(widthJisu, 0);
    expect(field.seats.find((s) => s.id === "subin")!.widthCm).toBe(0);
    expect(field.seats.map((s) => s.id)).toEqual(["jaki", "jisu", "subin"]);
  });

  it("removing 0cm member does not reset surviving territories", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
    ];
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c"],
      startCmPerMember: 100,
      fieldCm: 300,
      donationLinks: {
        a: { active: true, startedAt: 1 },
        b: { active: true, startedAt: 1 },
        c: { active: true, startedAt: 1 },
      },
      memberWidthCm: { a: 120, b: 0, c: 180 },
      memberWidthDonationSnapshot: { a: 50_000, b: 0, c: 80_000 },
    });
    const donors = [
      { memberId: "a", amount: 50_000, at: 2, ...hsTerritoryOn },
      { memberId: "c", amount: 80_000, at: 2, ...hsTerritoryOn },
    ];
    expect(
      shouldClearMemberWidthSnapshotOnSeatChange({
        prevSettings: settings,
        nextSettings: normalizeHighSocietySettings({ ...settings, seatMemberIds: ["a", "c"] }),
        members,
        donors,
      })
    ).toBe(false);
    const next = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settings,
      nextSettings: normalizeHighSocietySettings({ ...settings, seatMemberIds: ["a", "c"] }),
      members,
      donors,
    });
    expect(next.memberWidthCm?.a).toBeCloseTo(120, 0);
    expect(next.memberWidthCm?.c).toBeCloseTo(180, 0);
  });

  it("땅이 있는 멤버를 빼도 남은 영토는 유지되고 자리 이동으로 되살아나지 않는다", () => {
    const members = [
      { id: "gwak", name: "곽호경", account: 0, toon: 0, operating: false },
      { id: "young", name: "영실이", account: 0, toon: 0, operating: false },
      { id: "jaki", name: "자키", account: 0, toon: 0, operating: false },
      { id: "yuri", name: "유리", account: 0, toon: 0, operating: false },
      { id: "pong", name: "풍이", account: 0, toon: 0, operating: false },
      { id: "reze", name: "레제", account: 0, toon: 0, operating: false },
    ];
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["gwak", "young", "jaki", "yuri", "pong", "reze"],
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      fieldCm: 600,
      memberWidthCm: { gwak: 100, young: 100, jaki: 0, yuri: 300, pong: 5, reze: 95 },
    });
    const logs = [
      createTerritoryLog("yuri", 1, 200, { pushDir: "split", now: 1_000 }),
      createTerritoryLog("pong", 1, 5, { pushDir: "split", now: 2_000 }),
    ];
    const before = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: settings,
      territoryLogs: logs,
    });
    const widthBefore = Object.fromEntries(before.seats.map((seat) => [seat.id, seat.widthCm]));
    const removed = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settings,
      nextSettings: normalizeHighSocietySettings({
        ...settings,
        seatMemberIds: ["gwak", "young", "jaki"],
        seatMemberIdsManual: true,
      }),
      members,
      territoryLogs: logs,
    });
    expect(removed.seatMemberIds).toEqual(["gwak", "young", "jaki"]);
    expect(removed.memberWidthCm?.gwak).toBe(Math.round(widthBefore.gwak));
    expect(removed.memberWidthCm?.young).toBe(Math.round(widthBefore.young));
    expect(removed.memberWidthCm?.jaki).toBe(Math.round(widthBefore.jaki));

    const afterRemove = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: removed,
      territoryLogs: logs,
    });
    expect(afterRemove.seats.map((s) => s.id)).toEqual(["gwak", "young", "jaki"]);
    expect(afterRemove.seats.find((s) => s.id === "gwak")!.widthCm).toBe(Math.round(widthBefore.gwak));
    expect(afterRemove.seats.find((s) => s.id === "jaki")!.widthCm).toBe(Math.round(widthBefore.jaki));

    const revived = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: removed,
      nextSettings: normalizeHighSocietySettings({
        ...removed,
        seatMemberIds: ["gwak", "young", "jaki", "yuri"],
        seatMemberIdsManual: true,
      }),
      members,
      territoryLogs: logs,
    });
    expect(revived.seatMemberIds).toEqual(["gwak", "young", "jaki", "yuri"]);
    expect(revived.memberWidthCm?.gwak).toBe(Math.round(widthBefore.gwak));
    expect(revived.memberWidthCm?.jaki).toBe(Math.round(widthBefore.jaki));
    expect(revived.memberWidthCm?.yuri).toBe(100);

    const moved = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: revived,
      nextSettings: normalizeHighSocietySettings({
        ...revived,
        seatMemberIds: ["gwak", "yuri", "young", "jaki"],
        seatMemberIdsManual: true,
      }),
      members,
      territoryLogs: logs,
    });
    expect(moved.seatMemberIds).toEqual(["gwak", "yuri", "young", "jaki"]);
    expect(moved.seatMemberIds).not.toContain("reze");
    expect(moved.seatMemberIds).not.toContain("pong");
    const afterMove = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: moved,
      territoryLogs: logs,
    });
    expect(afterMove.seats.map((s) => s.id)).toEqual(["gwak", "yuri", "young", "jaki"]);
    expect(afterMove.seats.find((s) => s.id === "gwak")!.widthCm).toBe(Math.round(widthBefore.gwak));
    expect(afterMove.seats.find((s) => s.id === "jaki")!.widthCm).toBe(Math.round(widthBefore.jaki));
    expect(afterMove.seats.find((s) => s.id === "yuri")!.widthCm).toBe(100);
  });
});

describe("syncHighSocietyMemberWidthSnapshot", () => {
  const members = [
    { id: "subin", name: "수빈", account: 0, toon: 0, operating: false },
    { id: "jaki", name: "자키", account: 0, toon: 204_700, operating: false },
    { id: "jisu", name: "지수", account: 0, toon: 200, operating: false },
  ];
  const linkAt = 1000;
  const baseSettings = normalizeHighSocietySettings({
    enabled: true,
    seatMemberIds: ["subin", "jaki", "jisu"],
    seatMemberIdsManual: true,
    startCmPerMember: 100,
    fieldCm: 300,
    territoryUpdateMode: "realtime",
    donationLinks: {
      subin: { active: true, startedAt: linkAt },
      jaki: { active: true, startedAt: linkAt },
      jisu: { active: true, startedAt: linkAt },
    },
  });
  const donors = [
    { id: "d-jaki", name: "a", amount: 210_000, memberId: "jaki", at: 2000, ...hsTerritoryOn },
    { id: "d-jisu", name: "b", amount: 200_000, memberId: "jisu", at: 2000, ...hsTerritoryOn },
  ];

  it("sync writes snapshot so OBS field matches live resolution", () => {
    const state = {
      members,
      donors,
      highSocietySettings: baseSettings,
      territoryLogs: [],
    };
    const live = buildHighSocietyFieldFromAppState({
      ...state,
      highSocietySettings: normalizeHighSocietySettings({
        ...baseSettings,
        memberWidthCm: undefined,
        memberWidthDonationSnapshot: undefined,
        memberTerritoryExpand: undefined,
      }),
    });
    const synced = syncHighSocietyMemberWidthSnapshotInState(state as never);
    expect(shouldSyncHighSocietyMemberWidthSnapshot(synced.highSocietySettings)).toBe(true);
    const withSnap = buildHighSocietyFieldFromAppState(synced as never);
    for (const seat of live.seats) {
      expect(withSnap.seats.find((s) => s.id === seat.id)!.widthCm).toBeCloseTo(seat.widthCm, 0);
    }
    expect(withSnap.seats.reduce((s, x) => s + x.widthCm, 0)).toBeCloseTo(300, 0);
  });

  it("does not sync when territory paused; onRoundEnd leftover still syncs", () => {
    const state = { members, donors, highSocietySettings: baseSettings, territoryLogs: [] };
    const paused = syncHighSocietyMemberWidthSnapshotInState({
      ...(state as never),
      highSocietySettings: normalizeHighSocietySettings({
        ...baseSettings,
        territoryPaused: true,
      }),
    });
    expect(paused.highSocietySettings?.memberWidthCm).toBeUndefined();
    const roundEnd = syncHighSocietyMemberWidthSnapshotInState({
      ...(state as never),
      highSocietySettings: normalizeHighSocietySettings({
        ...baseSettings,
        territoryUpdateMode: "onRoundEnd",
      }),
    });
    expect(roundEnd.highSocietySettings?.memberWidthCm).toBeDefined();
  });

  it("highSocietyNeedsMemberWidthSnapshotPersist when snapshot missing", () => {
    const state = { members, donors, highSocietySettings: baseSettings, territoryLogs: [] };
    expect(highSocietyNeedsMemberWidthSnapshotPersist(state as never)).toBe(true);
    const synced = syncHighSocietyMemberWidthSnapshotInState(state as never);
    expect(highSocietyNeedsMemberWidthSnapshotPersist(synced as never)).toBe(false);
  });
});

describe("highSocietyAdminPreviewIframeKeySig", () => {
  it("ignores donationLinks and updatedAt so iframe key stays stable on donations", () => {
    const base = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b"],
      donationLinks: { a: { active: true, startedAt: 1000 } },
    });
    const afterDonation = normalizeHighSocietySettings({
      ...base,
      donationLinks: { a: { active: true, startedAt: 1000 }, b: { active: true, startedAt: 5000 } },
      memberTerritoryExpand: { a: { expandLeftCm: 1, expandRightCm: 2 } },
    });
    const keyA = highSocietyAdminPreviewIframeKeySig(base);
    const keyB = highSocietyAdminPreviewIframeKeySig(afterDonation);
    expect(keyA).toBe(keyB);
    const fullA = highSocietyAdminPreviewSig(base, { updatedAt: 1000, donorTerritorySig: "x" });
    const fullB = highSocietyAdminPreviewSig(afterDonation, { updatedAt: 9000, donorTerritorySig: "y" });
    expect(fullA).not.toBe(fullB);
  });
});

describe("manual territory log vs neighbor width", () => {
  const threeMembers = [
    { id: "subin", name: "수빈", account: 0, toon: 0, operating: false },
    { id: "jaki", name: "자키", account: 204_700, toon: 0, operating: false },
    { id: "jisu", name: "지수", account: 200, toon: 0, operating: false },
  ];

  it("appendTerritoryLog transfers from current snapshot (not full history replay)", () => {
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["subin", "jaki", "jisu"],
      startCmPerMember: 100,
      fieldCm: 300,
      memberWidthCm: { subin: 49, jaki: 105, jisu: 146 },
      memberWidthDonationSnapshot: { subin: 0, jaki: 0, jisu: 0 },
      memberTerritoryExpand: {
        subin: { expandLeftCm: 0, expandRightCm: 0 },
        jaki: { expandLeftCm: 0, expandRightCm: 0 },
        jisu: { expandLeftCm: 0, expandRightCm: 0 },
      },
    });
    const before = {
      members: threeMembers,
      donors: [] as never[],
      highSocietySettings: settings,
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
      updatedAt: 1,
    } as never;
    const next = appendTerritoryLogToAppState(
      before,
      createTerritoryLog("jisu", 1, 105, { pushDir: "left" })
    );
    const field = buildHighSocietyFieldFromAppState(next);
    const jaki = field.seats.find((s) => s.id === "jaki")!;
    const jisu = field.seats.find((s) => s.id === "jisu")!;
    expect(jaki.widthCm).toBeLessThan(105);
    expect(jisu.widthCm).toBeGreaterThan(146);
  });

  it("eliminates neighbor when manual log transfers full width (지수 +105 ← 자키)", () => {
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["subin", "jaki", "jisu"],
      startCmPerMember: 100,
      fieldCm: 300,
      memberWidthCm: { subin: 49, jaki: 105, jisu: 146 },
      memberWidthDonationSnapshot: { subin: 0, jaki: 0, jisu: 0 },
      memberTerritoryExpand: {
        subin: { expandLeftCm: 0, expandRightCm: 0 },
        jaki: { expandLeftCm: 0, expandRightCm: 0 },
        jisu: { expandLeftCm: 0, expandRightCm: 0 },
      },
    });
    const before = {
      members: threeMembers,
      donors: [] as never[],
      highSocietySettings: settings,
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
      updatedAt: 1,
    } as never;
    const next = appendTerritoryLogToAppState(
      before,
      createTerritoryLog("jisu", 1, 105, { pushDir: "left" })
    );
    const field = buildHighSocietyFieldFromAppState(next);
    const jaki = field.seats.find((s) => s.id === "jaki")!;
    const jisu = field.seats.find((s) => s.id === "jisu")!;
    expect(jaki.eliminated).toBe(true);
    expect(jaki.widthCm).toBe(0);
    expect(jisu.widthCm).toBeGreaterThan(146);
    expect(field.seats.reduce((s, x) => s + x.widthCm, 0)).toBeCloseTo(300, 0);
  });

  it("자리만 옮겨도 저장된 15cm 는 기록 재계산으로 115cm가 되지 않는다", () => {
    const members = [
      { id: "subin", name: "수빈", account: 0, toon: 0, operating: false },
      { id: "saa", name: "사아", account: 0, toon: 0, operating: false },
      { id: "gana", name: "가나", account: 0, toon: 0, operating: false },
      { id: "jaki", name: "자키", account: 0, toon: 0, operating: false },
    ];
    let settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["subin", "saa", "gana", "jaki"],
      startCmPerMember: 100,
      fieldCm: 400,
      memberWidthCm: { subin: 100, saa: 100, gana: 185, jaki: 15 },
      memberWidthDonationSnapshot: { subin: 0, saa: 0, gana: 0, jaki: 0 },
      memberTerritoryExpand: {
        subin: { expandLeftCm: 0, expandRightCm: 0 },
        saa: { expandLeftCm: 0, expandRightCm: 0 },
        gana: { expandLeftCm: 0, expandRightCm: 0 },
        jaki: { expandLeftCm: 0, expandRightCm: 15 },
      },
      donationLinks: {
        subin: { active: true, startedAt: 1 },
        saa: { active: true, startedAt: 1 },
        gana: { active: true, startedAt: 1 },
        jaki: { active: true, startedAt: 1 },
      },
    });
    const donors: Array<{ memberId: string; amount: number; at: number }> = [];
    const logs = [createTerritoryLog("jaki", 1, 15, { pushDir: "left" })];
    const before = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: settings,
      territoryLogs: logs,
    });
    expect(before.seats.find((s) => s.id === "jaki")!.widthCm).toBe(15);
    expect(before.seats.reduce((n, s) => n + s.widthCm, 0)).toBe(400);

    const widthBefore = Object.fromEntries(before.seats.map((seat) => [seat.id, seat.widthCm]));
    settings = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settings,
      nextSettings: normalizeHighSocietySettings({
        ...settings,
        seatMemberIds: ["subin", "saa", "jaki", "gana"],
      }),
      members,
      donors,
      territoryLogs: logs,
    });
    const after = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: settings,
      territoryLogs: logs,
    });
    expect(after.seats.map((seat) => seat.id)).toEqual(["subin", "saa", "jaki", "gana"]);
    expect(after.seats.find((s) => s.id === "jaki")!.widthCm).toBe(widthBefore.jaki);
    expect(after.seats.find((s) => s.id === "gana")!.widthCm).toBe(widthBefore.gana);
    expect(after.seats.find((s) => s.id === "saa")!.widthCm).toBe(widthBefore.saa);
    expect(after.seats.reduce((n, s) => n + s.widthCm, 0)).toBe(400);
  });
});

describe('high-society team mode (normalizeTeam / aggregateTeam / resolveTeamColor)', () => {
  it('normalizeTeam — id 필수, name 기본값 id, color hex 만 통과', () => {
    expect(normalizeTeam(null)).toBeNull();
    expect(normalizeTeam({})).toBeNull();
    expect(normalizeTeam({ id: '' })).toBeNull();
    const t1 = normalizeTeam({ id: 'red', name: '레드팀' });
    expect(t1).toEqual({ id: 'red', name: '레드팀' });
    const t2 = normalizeTeam({ id: 'blue', color: 'badcolor' });
    expect(t2).toEqual({ id: 'blue', name: 'blue' });
    const t3 = normalizeTeam({ id: 'green', name: '그린', color: '#10B981', seatOrderHint: 'x' });
    expect(t3).toEqual({ id: 'green', name: '그린', color: '#10B981' });
  });

  it('aggregateTeamPushesFromTerritoryLogs — 2팀 각 expand left/right 양분 집계', () => {
    const members = [
      { id: 'a1', name: 'A1' },
      { id: 'a2', name: 'A2' },
      { id: 'b1', name: 'B1' },
      { id: 'b2', name: 'B2' },
    ];
    const teams = [
      { id: 'ta', name: 'A팀' },
      { id: 'tb', name: 'B팀' },
    ];
    const assignments: Record<string, string> = { a1: 'ta', a2: 'ta', b1: 'tb', b2: 'tb' };
    const logs = [
      createTerritoryLog('a1', 1, 100, { pushDir: 'left' }),
      createTerritoryLog('a2', 1, 60, { pushDir: 'split' }),
      createTerritoryLog('b1', 1, 80, { pushDir: 'right' }),
      createTerritoryLog('b2', -1, 10, { pushDir: 'right' }),
    ];
    const settings = normalizeHighSocietySettings({ enabled: true });
    const out = aggregateTeamPushesFromTerritoryLogs({ seatPlayers: members, logs, settings, memberTeamAssignments: assignments, teams });
    expect(out).toHaveLength(2);
    const ta = out.find((x) => x.id === 'ta')!;
    const tb = out.find((x) => x.id === 'tb')!;
    expect(ta.teamName).toBe('A팀');
    expect(ta.expandLeftCm).toBe(100 + 30);
    expect(ta.expandRightCm).toBe(30);
    expect(ta.memberIds).toEqual(['a1', 'a2']);
    expect(tb.expandLeftCm).toBe(0);
    expect(tb.expandRightCm).toBe(80);
    expect(tb.memberIds).toEqual(['b1', 'b2']);
  });

  it('resolveTeamColor — user color 있으면 우선, 없으면 id hash 기반 할당', () => {
    const t1 = { id: 'team_red', name: 'R', color: '#EF4444' };
    expect(resolveTeamColor(t1, 0)).toBe('#EF4444');
    const noColor1 = resolveTeamColor({ id: 'team_blue', name: 'B' }, 0);
    const noColor2 = resolveTeamColor({ id: 'team_green', name: 'G' }, 1);
    expect(noColor1).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(noColor2).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(noColor1).not.toBe(noColor2);
  });

  it('팀전 영토 100cm 두 번(오른쪽) — 인접 0cm 좌석에서 전장을 깎지 않고 500/100', () => {
    const members = [
      { id: 'a1', name: '차지니', account: 0, toon: 0, operating: false },
      { id: 'a2', name: '나나', account: 0, toon: 0, operating: false },
      { id: 'a3', name: '김덕희', account: 0, toon: 0, operating: false },
      { id: 'b1', name: '오태림', account: 0, toon: 0, operating: false },
      { id: 'b2', name: '김덕희2', account: 0, toon: 0, operating: false },
      { id: 'b3', name: '전다은', account: 0, toon: 0, operating: false },
    ];
    const teams = [
      { id: 't1', name: '1팀' },
      { id: 't2', name: '2팀' },
    ];
    const assignments: Record<string, string> = {
      a1: 't1',
      a2: 't1',
      a3: 't1',
      b1: 't2',
      b2: 't2',
      b3: 't2',
    };
    const settings = normalizeHighSocietySettings({
      enabled: true,
      matchMode: 'team',
      seatMemberIds: members.map((m) => m.id),
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      teams,
      memberTeamAssignments: assignments,
    });
    let state = {
      members,
      donors: [],
      highSocietySettings: settings,
      territoryLogs: [],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog('a1', 1, 100, { pushDir: 'right', teamId: 't1' })
    );
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog('a1', 1, 100, { pushDir: 'right', teamId: 't1' })
    );
    const field = buildHighSocietyFieldFromAppState(state);
    const teamSeats = aggregateHighSocietySeatsByTeam(field.seats, normalizeHighSocietySettings(state.highSocietySettings));
    const t1 = teamSeats.find((s) => s.id === 'team:t1')!;
    const t2 = teamSeats.find((s) => s.id === 'team:t2')!;
    expect(t1.widthCm).toBe(500);
    expect(t2.widthCm).toBe(100);
    expect(t1.widthCm + t2.widthCm).toBe(600);
  });

  it('팀전 100 두 번 후 개인전→팀전 전환해도 500/100 유지', async () => {
    const members = [
      { id: 'a1', name: 'A1', account: 0, toon: 0, operating: false },
      { id: 'a2', name: 'A2', account: 0, toon: 0, operating: false },
      { id: 'a3', name: 'A3', account: 0, toon: 0, operating: false },
      { id: 'b1', name: 'B1', account: 0, toon: 0, operating: false },
      { id: 'b2', name: 'B2', account: 0, toon: 0, operating: false },
      { id: 'b3', name: 'B3', account: 0, toon: 0, operating: false },
    ];
    const teams = [
      { id: 't1', name: '1팀' },
      { id: 't2', name: '2팀' },
    ];
    const assignments: Record<string, string> = {
      a1: 't1', a2: 't1', a3: 't1', b1: 't2', b2: 't2', b3: 't2',
    };
    const settings = normalizeHighSocietySettings({
      enabled: true,
      matchMode: 'team',
      seatMemberIds: members.map((m) => m.id),
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      teams,
      memberTeamAssignments: assignments,
    });
    let state = {
      members,
      donors: [],
      highSocietySettings: settings,
      territoryLogs: [],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(state, createTerritoryLog('a1', 1, 100, { pushDir: 'right', teamId: 't1' }));
    state = appendTerritoryLogToAppState(state, createTerritoryLog('a1', 1, 100, { pushDir: 'right', teamId: 't1' }));
    const { applyHighSocietyAdminPatchToState } = await import('@/lib/admin-high-society-settings-patch');
    state = applyHighSocietyAdminPatchToState(state, { matchMode: 'individual' });
    expect(normalizeHighSocietySettings(state.highSocietySettings).matchMode).toBe('individual');
    state = applyHighSocietyAdminPatchToState(state, { matchMode: 'team' });
    expect(normalizeHighSocietySettings(state.highSocietySettings).matchMode).toBe('team');
    const field = buildHighSocietyFieldFromAppState(state);
    const teamSeats = aggregateHighSocietySeatsByTeam(field.seats, normalizeHighSocietySettings(state.highSocietySettings));
    expect(teamSeats.find((s) => s.id === 'team:t1')!.widthCm).toBe(500);
    expect(teamSeats.find((s) => s.id === 'team:t2')!.widthCm).toBe(100);
  });

  it('팀전 우측 팀 20cm에서 +20 오른쪽 — 벽이면 상대에서 20 전부 가져와 40 (ceil 분할 35 금지)', () => {
    const members = [
      { id: 'a1', name: 'A1', account: 0, toon: 0, operating: false },
      { id: 'a2', name: 'A2', account: 0, toon: 0, operating: false },
      { id: 'a3', name: 'A3', account: 0, toon: 0, operating: false },
      { id: 'b1', name: 'B1', account: 0, toon: 0, operating: false },
      { id: 'b2', name: 'B2', account: 0, toon: 0, operating: false },
      { id: 'b3', name: 'B3', account: 0, toon: 0, operating: false },
    ];
    const teams = [
      { id: 't1', name: '1팀' },
      { id: 't2', name: '2팀' },
    ];
    const assignments: Record<string, string> = {
      a1: 't1', a2: 't1', a3: 't1', b1: 't2', b2: 't2', b3: 't2',
    };
    const settings = normalizeHighSocietySettings({
      enabled: true,
      matchMode: 'team',
      seatMemberIds: members.map((m) => m.id),
      seatMemberIdsManual: true,
      startCmPerMember: 80,
      teams,
      memberTeamAssignments: assignments,
    });
    let state = {
      members,
      donors: [],
      highSocietySettings: settings,
      territoryLogs: [],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog('a1', 1, 220, { pushDir: 'right', teamId: 't1' })
    );
    const before = aggregateHighSocietySeatsByTeam(
      buildHighSocietyFieldFromAppState(state).seats,
      normalizeHighSocietySettings(state.highSocietySettings)
    );
    expect(before.find((s) => s.id === 'team:t2')!.widthCm).toBe(20);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog('b1', 1, 20, { pushDir: 'right', teamId: 't2' })
    );
    const teamSeats = aggregateHighSocietySeatsByTeam(
      buildHighSocietyFieldFromAppState(state).seats,
      normalizeHighSocietySettings(state.highSocietySettings)
    );
    expect(teamSeats.find((s) => s.id === 'team:t2')!.widthCm).toBe(40);
    expect(teamSeats.find((s) => s.id === 'team:t1')!.widthCm).toBe(440);
    expect(teamSeats.find((s) => s.id === 'team:t2')!.widthCm).not.toBe(35);
  });

  it('0cm 팀이 기록으로 +20 하면 한 번에 20이 생긴다', () => {
    const members = [
      { id: 'a1', name: 'A1', account: 0, toon: 0, operating: false },
      { id: 'a2', name: 'A2', account: 0, toon: 0, operating: false },
      { id: 'a3', name: 'A3', account: 0, toon: 0, operating: false },
      { id: 'b1', name: 'B1', account: 0, toon: 0, operating: false },
      { id: 'b2', name: 'B2', account: 0, toon: 0, operating: false },
      { id: 'b3', name: 'B3', account: 0, toon: 0, operating: false },
    ];
    const teams = [
      { id: 't1', name: '1팀' },
      { id: 't2', name: '2팀' },
    ];
    const assignments: Record<string, string> = {
      a1: 't1', a2: 't1', a3: 't1', b1: 't2', b2: 't2', b3: 't2',
    };
    const settings = normalizeHighSocietySettings({
      enabled: true,
      matchMode: 'team',
      seatMemberIds: members.map((m) => m.id),
      seatMemberIdsManual: true,
      startCmPerMember: 80,
      teams,
      memberTeamAssignments: assignments,
    });
    let state = {
      members,
      donors: [],
      highSocietySettings: settings,
      territoryLogs: [],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog('a1', 1, 240, { pushDir: 'right', teamId: 't1' })
    );
    expect(
      aggregateHighSocietySeatsByTeam(
        buildHighSocietyFieldFromAppState(state).seats,
        normalizeHighSocietySettings(state.highSocietySettings)
      ).find((s) => s.id === 'team:t2')!.widthCm
    ).toBe(0);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog('b1', 1, 20, { pushDir: 'right', teamId: 't2' })
    );
    const teamSeats = aggregateHighSocietySeatsByTeam(
      buildHighSocietyFieldFromAppState(state).seats,
      normalizeHighSocietySettings(state.highSocietySettings)
    );
    expect(teamSeats.find((s) => s.id === 'team:t2')!.widthCm).toBe(20);
    expect(teamSeats.find((s) => s.id === 'team:t1')!.widthCm).toBe(460);
  });

  it('팀전 기록부가 있어도 저장된 360/230 을 다시 계산해 435/45로 바꾸지 않는다', () => {
    const members = [
      { id: 'jaki', name: '자키', account: 0, toon: 0, operating: false },
      { id: 'nana', name: '나나', account: 0, toon: 0, operating: false },
      { id: 'lara', name: '김라라', account: 0, toon: 0, operating: false },
      { id: 'oharin', name: '오하린', account: 0, toon: 0, operating: false },
      { id: 'haru', name: '하루', account: 0, toon: 0, operating: false },
      { id: 'jindayul', name: '진다율', account: 0, toon: 0, operating: false },
    ];
    const teams = [
      { id: 'ta', name: 'TEAM A(자키,나나,김라라)' },
      { id: 'tb', name: 'TEAM B(오하린,하루,진다율)' },
    ];
    const assignments: Record<string, string> = {
      jaki: 'ta', nana: 'ta', lara: 'ta', oharin: 'tb', haru: 'tb', jindayul: 'tb',
    };
    const staleLeftover = {
      jaki: 120, nana: 120, lara: 120, oharin: 76, haru: 77, jindayul: 77,
    };
    const settings = normalizeHighSocietySettings({
      enabled: true,
      matchMode: 'team',
      seatMemberIds: members.map((m) => m.id),
      seatMemberIdsManual: true,
      startCmPerMember: 80,
      teams,
      memberTeamAssignments: assignments,
      memberWidthCm: staleLeftover,
    });
    const t0 = 1_000;
    const logs = [
      createTerritoryLog('jaki', 1, 20, { pushDir: 'right', teamId: 'ta', now: t0 }),
      createTerritoryLog('jaki', 1, 100, { pushDir: 'right', teamId: 'ta', now: t0 + 1 }),
      createTerritoryLog('jaki', 1, 100, { pushDir: 'right', teamId: 'ta', now: t0 + 2 }),
      createTerritoryLog('jaki', 1, 40, { pushDir: 'right', teamId: 'ta', now: t0 + 3 }),
      createTerritoryLog('oharin', 1, 20, { pushDir: 'right', teamId: 'tb', now: t0 + 4 }),
      createTerritoryLog('oharin', 1, 25, { pushDir: 'right', teamId: 'tb', now: t0 + 5 }),
    ];
    const state = {
      members,
      donors: [],
      highSocietySettings: settings,
      territoryLogs: logs,
    } as import("@/types").AppState;
    const field = buildHighSocietyFieldFromAppState(state);
    const teamSeats = aggregateHighSocietySeatsByTeam(
      field.seats,
      normalizeHighSocietySettings(state.highSocietySettings)
    );
    const teamA = teamSeats.find((s) => s.id === 'team:ta')!;
    const teamB = teamSeats.find((s) => s.id === 'team:tb')!;
    expect(teamA.widthCm).toBe(360);
    expect(teamB.widthCm).toBe(230);
    expect(teamA.widthCm + teamB.widthCm).toBe(590);
  });

  it("팀전 A+240 B+300 B+180 A+120 — 전체 replay 는 120/360, 앞 두 줄만이면 180/300", () => {
    const members = [
      { id: "jaki", name: "자키", account: 0, toon: 0, operating: false },
      { id: "nana", name: "나나", account: 0, toon: 0, operating: false },
      { id: "lara", name: "김라라", account: 0, toon: 0, operating: false },
      { id: "oharin", name: "오하린", account: 0, toon: 0, operating: false },
      { id: "haru", name: "하루", account: 0, toon: 0, operating: false },
      { id: "jindayul", name: "진다율", account: 0, toon: 0, operating: false },
    ];
    const teams = [
      { id: "ta", name: "TEAM A" },
      { id: "tb", name: "TEAM B" },
    ];
    const assignments: Record<string, string> = {
      jaki: "ta",
      nana: "ta",
      lara: "ta",
      oharin: "tb",
      haru: "tb",
      jindayul: "tb",
    };
    const settings = normalizeHighSocietySettings({
      enabled: true,
      matchMode: "team",
      seatMemberIds: members.map((m) => m.id),
      seatMemberIdsManual: true,
      startCmPerMember: 80,
      teams,
      memberTeamAssignments: assignments,
    });
    const t0 = 1_000;
    const logs = [
      createTerritoryLog("jaki", 1, 240, { pushDir: "right", teamId: "ta", now: t0 }),
      createTerritoryLog("oharin", 1, 300, { pushDir: "right", teamId: "tb", now: t0 + 1 }),
      createTerritoryLog("oharin", 1, 180, { pushDir: "right", teamId: "tb", now: t0 + 2 }),
      createTerritoryLog("jaki", 1, 120, { pushDir: "right", teamId: "ta", now: t0 + 3 }),
    ];
    const applied = (stateLogs: typeof logs) => {
      let state = {
        members,
        donors: [],
        highSocietySettings: settings,
        territoryLogs: [],
      } as import("@/types").AppState;
      for (const log of stateLogs) state = appendTerritoryLogToAppState(state, log);
      const read = () => {
        const field = buildHighSocietyFieldFromAppState(state);
        const teamSeats = aggregateHighSocietySeatsByTeam(field.seats, settings);
        return {
          a: teamSeats.find((s) => s.id === "team:ta")!.widthCm,
          b: teamSeats.find((s) => s.id === "team:tb")!.widthCm,
        };
      };
      return { first: read(), second: read() };
    };
    const two = applied(logs.slice(0, 2));
    const all = applied(logs);
    expect(two.second).toEqual(two.first);
    expect(all.second).toEqual(all.first);
    expect(two.first.a + two.first.b).toBe(480);
    expect(all.first.a + all.first.b).toBe(480);
    const unread = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: settings,
      territoryLogs: logs,
    } as import("@/types").AppState);
    const unreadTeams = aggregateHighSocietySeatsByTeam(unread.seats, settings);
    expect(unreadTeams.find((s) => s.id === "team:ta")!.widthCm).toBe(240);
    expect(unreadTeams.find((s) => s.id === "team:tb")!.widthCm).toBe(240);
  });

  it("팀전 A+80 A+40 B+50 A+10 — 전체 4줄은 320/160, 최신 2줄만이면 200/280", () => {
    const members = [
      { id: "jaki", name: "자키", account: 0, toon: 0, operating: false },
      { id: "nana", name: "나나", account: 0, toon: 0, operating: false },
      { id: "lara", name: "김라라", account: 0, toon: 0, operating: false },
      { id: "oharin", name: "오하린", account: 0, toon: 0, operating: false },
      { id: "haru", name: "하루", account: 0, toon: 0, operating: false },
      { id: "jindayul", name: "진다율", account: 0, toon: 0, operating: false },
    ];
    const teams = [
      { id: "ta", name: "TEAM A" },
      { id: "tb", name: "TEAM B" },
    ];
    const assignments: Record<string, string> = {
      jaki: "ta",
      nana: "ta",
      lara: "ta",
      oharin: "tb",
      haru: "tb",
      jindayul: "tb",
    };
    const settings = normalizeHighSocietySettings({
      enabled: true,
      matchMode: "team",
      seatMemberIds: members.map((m) => m.id),
      seatMemberIdsManual: true,
      startCmPerMember: 80,
      teams,
      memberTeamAssignments: assignments,
    });
    const t0 = 1_000;
    const logs = [
      createTerritoryLog("jaki", 1, 80, { pushDir: "right", teamId: "ta", now: t0 }),
      createTerritoryLog("jaki", 1, 40, { pushDir: "right", teamId: "ta", now: t0 + 1 }),
      createTerritoryLog("oharin", 1, 50, { pushDir: "right", teamId: "tb", now: t0 + 2 }),
      createTerritoryLog("jaki", 1, 10, { pushDir: "right", teamId: "ta", now: t0 + 3 }),
    ];
    const applied = (stateLogs: typeof logs) => {
      let state = {
        members,
        donors: [],
        highSocietySettings: settings,
        territoryLogs: [],
      } as import("@/types").AppState;
      for (const log of stateLogs) state = appendTerritoryLogToAppState(state, log);
      const field = buildHighSocietyFieldFromAppState(state);
      const again = buildHighSocietyFieldFromAppState(state);
      const teamSeats = aggregateHighSocietySeatsByTeam(field.seats, settings);
      const teamAgain = aggregateHighSocietySeatsByTeam(again.seats, settings);
      return {
        a: teamSeats.find((s) => s.id === "team:ta")!.widthCm,
        b: teamSeats.find((s) => s.id === "team:tb")!.widthCm,
        a2: teamAgain.find((s) => s.id === "team:ta")!.widthCm,
        b2: teamAgain.find((s) => s.id === "team:tb")!.widthCm,
      };
    };
    const all = applied(logs);
    expect(all.a2).toBe(all.a);
    expect(all.b2).toBe(all.b);
    expect(all.a + all.b).toBe(480);
  });

  it('normalize — matchMode 키 없어도 teams 가 있으면 팀전 유지', () => {
    const n = normalizeHighSocietySettings({
      enabled: true,
      teams: [{ id: 't1', name: '1팀' }, { id: 't2', name: '2팀' }],
      memberTeamAssignments: { a: 't1' },
    });
    expect(n.matchMode).toBe('team');
    const explicit = normalizeHighSocietySettings({
      enabled: true,
      matchMode: 'individual',
      teams: [{ id: 't1', name: '1팀' }],
    });
    expect(explicit.matchMode).toBe('individual');
  });
});

describe('high-society seat rejoin (member 빠졌다 재가입) — territory 복원 정확성', () => {
  const baseMembers = [
    { id: 'm1', name: 'M1', account: 0, toon: 0, operating: false },
    { id: 'm2', name: 'M2', account: 0, toon: 0, operating: false },
    { id: 'm3', name: 'M3', account: 0, toon: 0, operating: false },
    { id: 'm4', name: 'M4', account: 0, toon: 0, operating: false },
  ];

  it('seat 에 없던 멤버가 새로 진입 → 기존 좌석은 화면에 보이던 폭을 유지하고 신규는 시작 너비', () => {
    const settingsBefore = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ['m1', 'm3'],
      seatMemberIdsManual: true,
      startCmPerMember: 60,
      fieldCm: 400,
      memberWidthCm: { m1: 100, m3: 100 },
      memberTerritoryExpand: {
        m1: { expandLeftCm: 0, expandRightCm: 0 },
        m3: { expandLeftCm: 0, expandRightCm: 0 },
      },
    });
    const logs = [
      createTerritoryLog('m2', 1, 50, { pushDir: 'left' }),
      createTerritoryLog('m2', 1, 30, { pushDir: 'split' }),
    ];
    const settingsRejoin = normalizeHighSocietySettings({
      ...settingsBefore,
      seatMemberIds: ['m1', 'm2', 'm3'],
    });
    const clearCheck = shouldClearMemberWidthSnapshotOnSeatChange({
      prevSettings: settingsBefore,
      nextSettings: settingsRejoin,
      members: baseMembers,
      donors: [],
    });
    expect(clearCheck).toBe(false);
    const next = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settingsBefore,
      nextSettings: settingsRejoin,
      members: baseMembers,
      donors: [],
      territoryLogs: logs,
      now: 1,
    });
    expect(next.memberWidthCm?.m1).toBe(100);
    expect(next.memberWidthCm?.m3).toBe(100);
    expect(next.memberWidthCm?.m2).toBe(60);
    expect(next.memberTerritoryExpand?.m2?.expandLeftCm).toBe(0);
    expect(next.memberTerritoryExpand?.m2?.expandRightCm).toBe(0);
    const nextState = {
      id: 'x',
      userId: 'x',
      createdAt: 0,
      startedAt: 0,
      liveInfo: { status: 'offline' },
      settings: { locale: 'ko-KR' },
      members: baseMembers,
      donors: [],
      memberTotals: { rows: [] },
      highSocietySettings: next,
      territoryLogs: logs,
      updatedAt: 1,
    } as unknown as AppState;
    const reconciled = reconcileHighSocietyFieldDimensions(next, resolveHighSocietySeatCountForField(next, 3), baseMembers);
    expect(reconciled.fieldCm).toBeGreaterThan(0);
    const field = buildHighSocietyFieldFromAppState(nextState);
    const m2 = field.seats.find((s) => s.id === 'm2')!;
    expect(m2.expandLeftCm).toBe(0);
    expect(m2.expandRightCm).toBe(0);
    expect(m2.widthCm).toBeGreaterThan(0);
    expect(field.seats.reduce((n, s) => n + s.widthCm, 0)).toBe(field.fieldCm);
  });

  it('재가입 멤버는 기록부 재집계 없이 시작 너비로 합류', () => {
    const prevSettings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ['m1', 'm3'],
      seatMemberIdsManual: true,
      startCmPerMember: 80,
      fieldCm: 400,
      memberWidthCm: { m1: 80, m3: 80 },
      memberTerritoryExpand: {
        m1: { expandLeftCm: 0, expandRightCm: 0 },
        m3: { expandLeftCm: 0, expandRightCm: 0 },
      },
    });
    const nextSettings = normalizeHighSocietySettings({
      ...prevSettings,
      seatMemberIds: ['m1', 'm2', 'm3'],
    });
    const logs = [createTerritoryLog('m2', 1, 100, { pushDir: 'right' })];
    const next = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings,
      nextSettings,
      members: baseMembers,
      donors: [],
      territoryLogs: logs,
      now: 1,
    });
    expect(next.memberWidthCm?.m2).toBe(80);
    expect(next.memberTerritoryExpand?.m2?.expandRightCm).toBe(0);
    expect(next.memberTerritoryExpand?.m2?.expandLeftCm).toBe(0);
  });

  it('영토 기록 삭제 후 콜드 재계산 → 삭제된 기록만큼 m2 너비 감소 (좀비 expand 방지)', () => {
    const stateBefore: AppState = {
      id: 'x',
      userId: 'x',
      createdAt: 0,
      startedAt: 0,
      liveInfo: { status: 'offline' },
      settings: { locale: 'ko-KR' } as AppState['settings'],
      members: baseMembers,
      donors: [],
      memberTotals: { rows: [] },
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ['m1', 'm2', 'm3'],
        seatMemberIdsManual: true,
        startCmPerMember: 60,
        fieldCm: 300,
      }),
      territoryLogs: [createTerritoryLog('m2', 1, 60, { pushDir: 'left' })],
      updatedAt: 1,
    } as AppState;
    const afterAdd = appendTerritoryLogToAppState(stateBefore, createTerritoryLog('m2', 1, 40, { pushDir: 'left' }));
    const fieldAdd = buildHighSocietyFieldFromAppState(afterAdd);
    const m2AddW = fieldAdd.seats.find((s) => s.id === 'm2')!.widthCm;
    expect(m2AddW).toBeGreaterThan(60);
    const targetId = afterAdd.territoryLogs[afterAdd.territoryLogs.length - 1]!.id;
    const afterRemove = removeTerritoryLogFromAppState(afterAdd, targetId);
    expect(afterRemove.territoryLogs).toHaveLength(1);
    const fieldRemove = buildHighSocietyFieldFromAppState(afterRemove);
    const m2RemoveSeat = fieldRemove.seats.find((s) => s.id === 'm2')!;
    const totalAfter = fieldRemove.seats.reduce((s, x) => s + x.widthCm, 0);
    expect(m2RemoveSeat.widthCm).toBeGreaterThanOrEqual(60);
    expect(totalAfter).toBeLessThanOrEqual(300);
  });
});

describe("상류사회 시나리오 회귀 (개인전 양분·0cm 끝 재진입·전장 합)", () => {
  function four() {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    return {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["a", "b", "c", "d"],
        startCmPerMember: 100,
        fieldCm: 400,
        matchMode: "individual",
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
  }

  function widths(state: import("@/types").AppState) {
    const field = buildHighSocietyFieldFromAppState(state);
    const byId: Record<string, number> = {};
    for (const s of field.seats) byId[s.id] = s.widthCm;
    const total = field.seats.reduce((s, x) => s + x.widthCm, 0);
    const alive = field.seats.filter((s) => !s.eliminated).map((s) => s.id);
    return { field, byId, total, alive };
  }

  it("개인전 가운데 C도 무방향이면 좌우 양분", () => {
    let state = four();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 20, { now: 1_000 }));
    const { byId, total, alive } = widths(state);
    expect(byId.a).toBe(100);
    expect(byId.b).toBe(90);
    expect(byId.c).toBe(120);
    expect(byId.d).toBe(90);
    expect(total).toBe(400);
    expect(alive).toEqual(["a", "b", "c", "d"]);
  });

  it("5인 개인전 가운데 전원 무방향은 양분이고 전장 합은 유지", () => {
    const members = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      name: id.toUpperCase(),
      account: 0,
      toon: 0,
      operating: false,
    }));
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["a", "b", "c", "d", "e"],
        startCmPerMember: 100,
        fieldCm: 500,
        matchMode: "individual",
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 20, { now: 1_000 }));
    const { byId, total } = widths(state);
    expect(byId.b).toBe(90);
    expect(byId.c).toBe(120);
    expect(byId.d).toBe(90);
    expect(byId.a).toBe(100);
    expect(byId.e).toBe(100);
    expect(total).toBe(500);
  });

  it("홀수 21cm 양분은 좌우 10.5 이고 전장 합이 깨지지 않는다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 21, { now: 1_000 }));
    const { byId, total } = widths(state);
    expect(byId.a).toBe(89.5);
    expect(byId.b).toBe(121);
    expect(byId.c).toBe(89.5);
    expect(byId.d).toBe(100);
    expect(total).toBe(400);
  });

  it("5cm 양분은 좌우 2.5로 저장되고 0.5가 정수로 올라가지 않는다", () => {
    const members = ["곽호경", "염섬이", "유리", "자키", "레제", "풍이"].map((name, i) => ({
      id: `m${i}`,
      name,
      account: 0,
      toon: 0,
      operating: false,
    }));
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: members.map((m) => m.id),
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 600,
        matchMode: "individual",
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(state, createTerritoryLog("m2", 1, 5, { pushDir: "split", now: 1_000 }));
    state = appendTerritoryLogToAppState(state, createTerritoryLog("m2", 1, 50, { pushDir: "split", now: 2_000 }));
    state = appendTerritoryLogToAppState(state, createTerritoryLog("m2", 1, 200, { pushDir: "split", now: 3_000 }));
    const saved = state.highSocietySettings?.memberWidthCm || {};
    expect(saved.m0).toBe(72.5);
    expect(saved.m1).toBe(0);
    expect(saved.m2).toBe(355);
    expect(saved.m3).toBe(0);
    expect(saved.m4).toBe(72.5);
    expect(saved.m5).toBe(100);
    const shown = buildHighSocietyFieldFromAppState({
      ...state,
      highSocietySettings: normalizeHighSocietySettings({
        ...state.highSocietySettings,
        territorySnapshotEpochAt: 3_000,
      }),
    });
    const byId = Object.fromEntries(shown.seats.map((s) => [s.id, s.widthCm]));
    expect(byId.m0).toBe(72.5);
    expect(byId.m2).toBe(355);
    expect(byId.m4).toBe(72.5);
  });

  it("0cm이 된 이웃은 건너뛰고 그 너머에서 가져온다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 }));
    const afterEat = widths(state);
    expect(afterEat.byId.b).toBe(0);
    expect(afterEat.field.seats.find((s) => s.id === "b")!.eliminated).toBe(true);
    state = appendTerritoryLogToAppState(state, createTerritoryLog("a", 1, 20, { pushDir: "right", now: 2_000 }));
    const { byId, total } = widths(state);
    expect(byId.b).toBe(0);
    expect(byId.a).toBe(220);
    expect(byId.c).toBe(80);
    expect(byId.d).toBe(100);
    expect(total).toBe(400);
  });

  it("0cm 가운데 B는 끝을 고르기 전에 자리를 옮기지 않는다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 }));
    expect(widths(state).byId.b).toBe(0);
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 20, { now: 2_000 }));
    const { field, byId, total } = widths(state);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("b");
    expect(field.seats.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(byId.b).toBe(20);
    expect(byId.a).toBe(200);
    expect(total).toBe(420);
    expect(field.seats.find((s) => s.id === "b")!.eliminated).toBe(false);
  });

  it("0cm 가운데 C는 끝을 고르기 전에 오른쪽 끝 영토를 지우지 않는다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("d", 1, 100, { pushDir: "left", now: 1_000 }));
    expect(widths(state).byId.c).toBe(0);
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 20, { now: 2_000 }));
    const { field, byId, total } = widths(state);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("c");
    expect(field.seats.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(byId.c).toBe(20);
    expect(byId.d).toBe(200);
    expect(total).toBe(420);
  });

  it("두 명이 0cm가 된 뒤 한 명을 살리면 다른 한 명의 새 땅이 0이 되지 않는다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 }));
    state = appendTerritoryLogToAppState(state, createTerritoryLog("d", 1, 100, { pushDir: "left", now: 2_000 }));
    const mid = widths(state);
    expect(mid.byId.b).toBe(0);
    expect(mid.byId.c).toBe(0);
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 20, { pushDir: "left", now: 3_000 }));
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 20, { pushDir: "right", now: 4_000 }));
    const { field, byId, total } = widths(state);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds ?? []).not.toEqual(
      expect.arrayContaining(["b", "c"])
    );
    expect(field.seats.map((s) => s.id)).toEqual(["b", "a", "d", "c"]);
    expect(byId.b).toBe(20);
    expect(byId.c).toBe(20);
    expect(byId.a).toBe(180);
    expect(byId.d).toBe(180);
    expect(total).toBe(400);
  });

  it("음수로 0cm가 된 뒤 다시 살면 끝을 고르기 전에는 그 자리에 남는다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", -1, 100, { pushDir: "left", now: 1_000 }));
    expect(widths(state).byId.b).toBe(0);
    expect(widths(state).field.seats.find((s) => s.id === "b")!.eliminated).toBe(true);
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 30, { pushDir: "left", now: 2_000 }));
    const { field, byId, total } = widths(state);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds ?? []).not.toContain("b");
    expect(field.seats.map((s) => s.id)[0]).toBe("b");
    expect(byId.b).toBe(30);
    expect(byId.a).toBe(170);
    expect(total).toBe(400);
  });

  it("팀전 0cm 팀원은 끝으로 옮기지 않고 팀 합만 유지", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        matchMode: "team",
        seatMemberIds: ["a", "b", "c", "d"],
        startCmPerMember: 100,
        fieldCm: 400,
        teams: [
          { id: "t1", name: "A팀" },
          { id: "t2", name: "B팀" },
        ],
        memberTeamAssignments: { a: "t1", b: "t1", c: "t2", d: "t2" },
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 80, { pushDir: "right", teamId: "t1", now: 1_000 })
    );
    const { field, total } = widths(state);
    expect(total).toBe(400);
    const teams = aggregateHighSocietySeatsByTeam(field.seats, state.highSocietySettings!);
    const t1 = teams.find((t) => t.id === "team:t1");
    const t2 = teams.find((t) => t.id === "team:t2");
    expect((t1?.widthCm ?? 0) + (t2?.widthCm ?? 0)).toBe(400);
    expect(field.seats.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("영토 기록 삭제 후 콜드 재계산에서 전장 합이 유지된다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 40, { pushDir: "right", now: 1_000 }));
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 20, { pushDir: "left", now: 2_000 }));
    const lastId = state.territoryLogs[state.territoryLogs.length - 1]!.id;
    state = removeTerritoryLogFromAppState(state, lastId);
    const { total, byId } = widths(state);
    expect(state.territoryLogs).toHaveLength(1);
    expect(total).toBe(400);
    expect(byId.b).toBeGreaterThan(100);
  });

  it("같은 시각 기록도 입력한 순서대로 지금 판에 한 번씩만 반영한다", () => {
    const eat = {
      ...createTerritoryLog("a", 1, 100, { pushDir: "right", now: 9_000 }),
      id: "tl_zzz",
    };
    const reenter = {
      ...createTerritoryLog("b", 1, 20, { now: 9_000 }),
      id: "tl_aaa",
    };
    let state = four();
    state = appendTerritoryLogToAppState(state, eat);
    state = appendTerritoryLogToAppState(state, reenter);
    const { byId, total, field } = widths(state);
    expect(field.seats.map((seat) => seat.id)).toEqual(["a", "b", "c", "d"]);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("b");
    expect(byId.b).toBe(20);
    expect(byId.a).toBe(200);
    expect(total).toBe(420);
    expect(widths(state).byId).toEqual(byId);
  });

  it("0cm 재진입 이후 확장은 새 자리 이웃에서 가져온다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 })
    );
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 20, { now: 2_000 }));
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("b");
    expect(widths(state).byId.b).toBe(20);
    expect(widths(state).byId.a).toBe(200);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 20, { pushDir: "right", now: 3_000 })
    );
    const { byId, total, field } = widths(state);
    expect(byId.b).toBe(20);
    expect(byId.a).toBe(220);
    expect(byId.c).toBe(80);
    expect(byId.d).toBe(100);
    expect(total).toBe(420);
    expect(field.seats.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("끝 선택 대기 중에는 옆 확장이 그 땅을 가져가지 않는다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 })
    );
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 20, { now: 2_000 }));
    const waiting = buildHighSocietyFieldFromAppState(state);
    expect(waiting.seats.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 20, { pushDir: "right", now: 3_000 })
    );
    const next = buildHighSocietyFieldFromAppState(state);
    expect(next.seats.find((s) => s.id === "b")!.widthCm).toBe(20);
    expect(next.seats.find((s) => s.id === "a")!.widthCm).toBe(220);
    expect(next.seats.find((s) => s.id === "c")!.widthCm).toBe(80);
    expect(next.seats.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("3인 가운데 0cm는 끝을 고르기 전에 왼쪽 끝으로 옮기지 않는다", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
    ];
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ["a", "b", "c"],
        startCmPerMember: 100,
        fieldCm: 300,
        matchMode: "individual",
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 })
    );
    expect(widths(state).byId.b).toBe(0);
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 20, { now: 2_000 }));
    const { field, byId, total } = widths(state);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("b");
    expect(field.seats.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(byId.b).toBe(20);
    expect(byId.a).toBe(200);
    expect(byId.c).toBe(100);
    expect(total).toBe(320);
  });

  it("왼쪽 끝에 앉아 0cm가 된 사람은 다시 살아도 그 끝에 남고 안쪽에서 가져온다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", -1, 100, { pushDir: "right", now: 1_000 })
    );
    expect(widths(state).byId.a).toBe(0);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 30, { pushDir: "right", now: 2_000 })
    );
    const { alive, byId, total } = widths(state);
    expect(alive[0]).toBe("a");
    expect(byId.a).toBe(30);
    expect(byId.b).toBe(170);
    expect(total).toBe(400);
  });

  it("양 끝을 다시 살릴 때 오른쪽 끝의 왼쪽 기록은 왼쪽 끝 영토를 지우지 않는다", () => {
    const ids = ["pong", "jaki", "kwak", "young", "glass", "reze"] as const;
    const members = ids.map((id) => ({
      id,
      name: id,
      account: 0,
      toon: 0,
      operating: false,
    }));
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: [...ids],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 600,
        matchMode: "individual",
        territorySnapshotEpochAt: 5_000,
        memberWidthCm: {
          pong: 5,
          jaki: 95,
          kwak: 100,
          young: 100,
          glass: 300,
          reze: 0,
        },
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("reze", 1, 5, { pushDir: "left", now: 6_000 })
    );
    const { field, byId, total, alive } = widths(state);
    expect(field.seats.map((seat) => seat.id)).toEqual([...ids]);
    expect(alive[0]).toBe("pong");
    expect(alive[alive.length - 1]).toBe("reze");
    expect(byId.pong).toBe(5);
    expect(byId.jaki).toBe(95);
    expect(byId.kwak).toBe(100);
    expect(byId.young).toBe(100);
    expect(byId.glass).toBe(295);
    expect(byId.reze).toBe(5);
    expect(total).toBe(600);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds || []).not.toContain("reze");
    expect(state.highSocietySettings?.pendingEndEntryMemberIds || []).not.toContain("pong");
  });

  it("가운데에 100을 두 번 양분하면 200만 더하고 다시 읽어도 500이 되지 않는다", () => {
    const ids = ["jaki", "gwak", "pong", "yeong", "reze", "yuri"] as const;
    const members = ids.map((id) => ({
      id,
      name: id,
      account: 0,
      toon: 0,
      operating: false,
    }));
    let state = {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: [...ids],
        seatMemberIdsManual: true,
        startCmPerMember: 100,
        fieldCm: 600,
        matchMode: "individual",
        territoryLogsResetAt: 4_000,
        territorySnapshotEpochAt: 5_000,
        memberWidthCm: Object.fromEntries(ids.map((id) => [id, 100])),
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("pong", 1, 100, { pushDir: "split", now: 6_000 })
    );
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("pong", 1, 100, { pushDir: "split", now: 7_000 })
    );
    expect(widths(state).byId).toEqual({
      jaki: 100,
      gwak: 0,
      pong: 300,
      yeong: 0,
      reze: 100,
      yuri: 100,
    });
    const staleEpoch = {
      ...state,
      highSocietySettings: normalizeHighSocietySettings({
        ...state.highSocietySettings,
        territorySnapshotEpochAt: 5_000,
      }),
    };
    expect(widths(staleEpoch).byId.pong).toBe(300);
    const synced = syncHighSocietyMemberWidthSnapshotInState(staleEpoch);
    expect(widths(synced).byId.pong).toBe(300);
    const syncedAgain = syncHighSocietyMemberWidthSnapshotInState(synced);
    expect(widths(syncedAgain).byId.pong).toBe(300);
    expect(Number(syncedAgain.highSocietySettings?.territorySnapshotEpochAt || 0)).toBeGreaterThanOrEqual(
      7_000
    );
  });

  it("연속 양분 여러 번도 전장 합이 유지된다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 20, { now: 1_000 }));
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 20, { now: 2_000 }));
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 21, { now: 3_000 }));
    const { total, byId } = widths(state);
    expect(total).toBe(400);
    expect(byId.b).toBeGreaterThan(byId.a);
    expect(byId.c).toBeGreaterThan(byId.d);
  });

  it("오른쪽 끝에서 전장을 가로질러 가져와도 합은 유지", () => {
    let state = four();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("d", 1, 250, { pushDir: "left", now: 1_000 })
    );
    const { byId, total, alive } = widths(state);
    expect(total).toBe(400);
    expect(byId.d).toBe(350);
    expect(byId.c).toBe(0);
    expect(byId.b).toBe(0);
    expect(byId.a).toBe(50);
    expect(alive).toEqual(["a", "d"]);
  });

  it("기록 한 줄을 지우면 그 줄만 지금 판에서 되돌린다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 })
    );
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 20, { now: 2_000 }));
    const firstId = state.territoryLogs[0]!.id;
    state = removeTerritoryLogFromAppState(state, firstId);
    const { byId, total } = widths(state);
    expect(state.territoryLogs).toHaveLength(1);
    expect(byId.a).toBe(100);
    expect(byId.b).toBe(120);
    expect(byId.c).toBe(100);
    expect(byId.d).toBe(100);
    expect(total).toBe(420);
    expect(widths(state).byId).toEqual(byId);
  });

  it("0cm 재진입을 두 번 해도 끝에서만 다시 생긴다", () => {
    let state = four();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 })
    );
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 20, { now: 2_000 }));
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("b", -1, 20, { pushDir: "right", now: 3_000 })
    );
    expect(widths(state).byId.b).toBe(0);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("b", 1, 15, { pushDir: "right", now: 4_000 })
    );
    const { field, byId, total } = widths(state);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds ?? []).not.toContain("b");
    expect(field.seats.map((s) => s.id)).toEqual(["a", "c", "d", "b"]);
    expect(byId.b).toBe(15);
    expect(byId.c).toBe(120);
    expect(byId.d).toBe(85);
    expect(total).toBe(420);
  });
});

describe("상류사회 개인전 6인", () => {
  function six() {
    const ids = ["a", "b", "c", "d", "e", "f"] as const;
    const members = ids.map((id) => ({
      id,
      name: id.toUpperCase(),
      account: 0,
      toon: 0,
      operating: false,
    }));
    return {
      members,
      donors: [] as never[],
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: [...ids],
        startCmPerMember: 100,
        fieldCm: 600,
        matchMode: "individual",
      }),
      territoryLogs: [] as ReturnType<typeof createTerritoryLog>[],
    } as import("@/types").AppState;
  }

  function widths(state: import("@/types").AppState) {
    const field = buildHighSocietyFieldFromAppState(state);
    const byId: Record<string, number> = {};
    for (const s of field.seats) byId[s.id] = s.widthCm;
    const total = field.seats.reduce((s, x) => s + x.widthCm, 0);
    const alive = field.seats.filter((s) => !s.eliminated).map((s) => s.id);
    return { field, byId, total, alive };
  }

  it("시작은 6등분 100cm이고 전장 합은 600", () => {
    const { field, byId, total, alive } = widths(six());
    expect(field.playerCount).toBe(6);
    expect(field.seats.map((s) => s.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(field.seats.map((s) => s.expandDir)).toEqual([
      "right",
      "both",
      "both",
      "both",
      "both",
      "left",
    ]);
    expect(Object.values(byId)).toEqual([100, 100, 100, 100, 100, 100]);
    expect(total).toBe(600);
    expect(alive).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("기본 전장 1200이면 6인은 1인 200cm", () => {
    const { seats, startCm, fieldCm, playerCount } = resolveHighSocietyField({
      players: ["a", "b", "c", "d", "e", "f"].map((id) => ({
        id,
        name: id.toUpperCase(),
        donationWon: 0,
      })),
    });
    expect(playerCount).toBe(6);
    expect(fieldCm).toBe(HIGH_SOCIETY_DEFAULT_FIELD_CM);
    expect(startCm).toBe(200);
    expect(seats.map((s) => s.widthCm)).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it("가운데 C 무방향 +20은 좌우 양분 (B·D에서 10씩)", () => {
    let state = six();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 20, { now: 1_000 }));
    const { byId, total, alive } = widths(state);
    expect(byId).toEqual({ a: 100, b: 90, c: 120, d: 90, e: 100, f: 100 });
    expect(total).toBe(600);
    expect(alive).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("가운데 D 무방향 +20도 좌우 양분 (C·E에서 10씩)", () => {
    let state = six();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("d", 1, 20, { now: 1_000 }));
    const { byId, total } = widths(state);
    expect(byId).toEqual({ a: 100, b: 100, c: 90, d: 120, e: 90, f: 100 });
    expect(total).toBe(600);
  });

  it("홀수 21cm 양분은 좌우 10.5 이고 전장 합이 깨지지 않는다", () => {
    let state = six();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 21, { now: 1_000 }));
    const { byId, total } = widths(state);
    expect(byId.b).toBe(89.5);
    expect(byId.c).toBe(121);
    expect(byId.d).toBe(89.5);
    expect(byId.a).toBe(100);
    expect(byId.e).toBe(100);
    expect(byId.f).toBe(100);
    expect(total).toBe(600);
  });

  it("왼쪽 끝 A는 오른쪽으로만 밀어 B에서 가져온다", () => {
    let state = six();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 20, { pushDir: "right", now: 1_000 })
    );
    const { byId, total } = widths(state);
    expect(byId).toEqual({ a: 120, b: 80, c: 100, d: 100, e: 100, f: 100 });
    expect(total).toBe(600);
  });

  it("오른쪽 끝 F는 왼쪽으로만 밀어 E에서 가져온다", () => {
    let state = six();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("f", 1, 20, { pushDir: "left", now: 1_000 })
    );
    const { byId, total } = widths(state);
    expect(byId).toEqual({ a: 100, b: 100, c: 100, d: 100, e: 80, f: 120 });
    expect(total).toBe(600);
  });

  it("0cm 이웃은 건너뛰고 그 너머에서 가져온다", () => {
    let state = six();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 })
    );
    expect(widths(state).byId.b).toBe(0);
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 20, { pushDir: "right", now: 2_000 })
    );
    const { byId, total, field } = widths(state);
    expect(byId.b).toBe(0);
    expect(byId.a).toBe(220);
    expect(byId.c).toBe(80);
    expect(byId.d).toBe(100);
    expect(total).toBe(600);
    expect(field.seats.find((s) => s.id === "b")!.eliminated).toBe(true);
  });

  it("0cm이 된 B가 무방향이면 왼쪽 끝으로 재진입", () => {
    let state = six();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 })
    );
    state = appendTerritoryLogToAppState(state, createTerritoryLog("b", 1, 20, { now: 2_000 }));
    const { byId, total, field } = widths(state);
    expect(state.highSocietySettings?.pendingEndEntryMemberIds).toContain("b");
    expect(byId.b).toBe(20);
    expect(byId.a).toBe(200);
    expect(total).toBe(620);
    expect(field.seats.map((s) => s.id)[0]).toBe("a");
  });

  it("오른쪽 끝에서 전장을 가로질러 가져와도 합은 600", () => {
    let state = six();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("f", 1, 450, { pushDir: "left", now: 1_000 })
    );
    const { byId, total, alive } = widths(state);
    expect(total).toBe(600);
    expect(byId.f).toBe(550);
    expect(byId.e).toBe(0);
    expect(byId.d).toBe(0);
    expect(byId.c).toBe(0);
    expect(byId.b).toBe(0);
    expect(byId.a).toBe(50);
    expect(alive).toEqual(["a", "f"]);
  });

  it("연속 양분 여러 번도 전장 합이 유지된다", () => {
    let state = six();
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 20, { now: 1_000 }));
    state = appendTerritoryLogToAppState(state, createTerritoryLog("d", 1, 20, { now: 2_000 }));
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 21, { now: 3_000 }));
    const { total, byId } = widths(state);
    expect(total).toBe(600);
    expect(byId.c).toBeGreaterThan(byId.b);
    expect(byId.d).toBeGreaterThan(byId.e);
  });
});
