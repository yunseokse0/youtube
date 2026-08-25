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
  resolveHighSocietySeatMembers,
  resolveHighSocietySeatMemberIdsForEdit,
  appendHighSocietySeatMemberId,
  insertHighSocietySeatMemberIdAt,
  mergeHighSocietySettingsPreferBaseline,
  defaultHighSocietySettings,
  isDonationAmountEligibleForHighSocietyTerritory,
  shouldDonorCountForHighSocietyTerritory,
  highSocietyAdminPreviewSig,
  highSocietyAdminPreviewIframeKeySig,
  syncHighSocietyMemberWidthSnapshotInState,
  shouldSyncHighSocietyMemberWidthSnapshot,
  highSocietyNeedsMemberWidthSnapshotPersist,
  appendTerritoryLogToAppState,
  removeTerritoryLogFromAppState,
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
        { id: "a", name: "A", donationWon: 100_000 }, // 50cm
        { id: "b", name: "B", donationWon: 0 },
        { id: "c", name: "C", donationWon: 0 },
        { id: "d", name: "D", donationWon: 0 },
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
        { id: "a", name: "A", donationWon: 0 },
        { id: "b", name: "B", donationWon: 0 },
        { id: "c", name: "C", donationWon: 0 },
        { id: "d", name: "D", donationWon: 40_000 }, // 20cm
      ],
    });
    expect(seats[3]!.widthCm).toBe(320);
    expect(seats[2]!.widthCm).toBe(280);
  });

  it("B all-left push expands into A", () => {
    const { seats } = resolveHighSocietyField({
      players: [
        { id: "a", name: "A", donationWon: 0 },
        { id: "b", name: "B", donationWon: 60_000 }, // 30cm
        { id: "c", name: "C", donationWon: 0 },
        { id: "d", name: "D", donationWon: 0 },
      ],
      split: { bLeft: 1, cLeft: 0.5 },
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
        { id: "a", name: "A", donationWon: 600_000 }, // 300cm — eats all of B start
        { id: "b", name: "B", donationWon: 0 },
        { id: "c", name: "C", donationWon: 0 },
        { id: "d", name: "D", donationWon: 0 },
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
    expect(formatCm(230.1)).toBe("230cm");
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

  it("parses territory update mode (realtime | onRoundEnd)", () => {
    expect(parseHighSocietyTerritoryUpdateMode("realtime")).toBe("realtime");
    expect(parseHighSocietyTerritoryUpdateMode("onRoundEnd")).toBe("onRoundEnd");
    expect(parseHighSocietyTerritoryUpdateMode("end")).toBe("onRoundEnd");
    expect(parseHighSocietyTerritoryUpdateMode("")).toBe("realtime");
    expect(normalizeHighSocietySettings({ territoryUpdateMode: "onRoundEnd" }).territoryUpdateMode).toBe(
      "onRoundEnd"
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
    const rightPush = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: baseSettings,
      territoryLogs: [createTerritoryLog("b", 1, 50, { pushDir: "right" })],
    });
    const leftPush = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: baseSettings,
      territoryLogs: [createTerritoryLog("b", 1, 50, { pushDir: "left" })],
    });
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
    const field = buildHighSocietyFieldFromAppState({
      members,
      donors: [],
      highSocietySettings: resumed,
      territoryLogs: [createTerritoryLog("b", 1, 50, { pushDir: "right" })],
    });
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

  it("first ON without prior link sets startedAt (only post-ON donations count)", () => {
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
    expect(next.donationLinks?.a?.active).toBe(true);
    expect(next.donationLinks?.a?.startedAt).toBe(99_000);
    expect(next.donationLinks?.b?.startedAt).toBe(99_000);
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

  it("repairs corrupt memberWidthCm (expand-only width) without dropping zero-donation seats", () => {
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
    expect(field.seats.find((s) => s.id === "yoon")!.widthCm).toBeCloseTo(105, 0);
    expect(field.seats.reduce((s, x) => s + x.widthCm, 0)).toBeCloseTo(400, 0);
  });

  it("manual mode ignores startedAt — only territory ON rows expand", () => {
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

  it("resolveDonorsForHighSocietySettingsPatch marks hsTerritoryExcluded only on first ON", () => {
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
    expect(firstOn[0]!.hsTerritoryExcluded).toBe(true);
  });

  it("shouldPersistDonorsForHighSocietySettingsPatch is true only for first ON (not resetTerritory)", () => {
    expect(
      shouldPersistDonorsForHighSocietySettingsPatch({ resetTerritory: false, isFirstOn: false })
    ).toBe(false);
    expect(
      shouldPersistDonorsForHighSocietySettingsPatch({ resetTerritory: true, isFirstOn: false })
    ).toBe(false);
    expect(
      shouldPersistDonorsForHighSocietySettingsPatch({ resetTerritory: false, isFirstOn: true })
    ).toBe(true);
  });

  it("shouldMarkDonorsLocallyForHighSocietySettingsPatch is true only for first ON", () => {
    expect(
      shouldMarkDonorsLocallyForHighSocietySettingsPatch({ resetTerritory: false, isFirstOn: false })
    ).toBe(false);
    expect(
      shouldMarkDonorsLocallyForHighSocietySettingsPatch({ resetTerritory: true, isFirstOn: false })
    ).toBe(false);
    expect(
      shouldMarkDonorsLocallyForHighSocietySettingsPatch({ resetTerritory: false, isFirstOn: true })
    ).toBe(true);
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

  it("resolveDonationSyncModeForHighSocietySettingsChange restores mealBattle on OFF", () => {
    expect(
      resolveDonationSyncModeForHighSocietySettingsChange({
        turningOn: false,
        turningOff: true,
        prevMode: "highSociety",
      })
    ).toBe("mealBattle");
    expect(
      resolveDonationSyncModeForHighSocietySettingsChange({
        turningOn: true,
        turningOff: false,
        prevMode: "mealBattle",
      })
    ).toBe("highSociety");
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
    expect(next.donationLinks?.b?.startedAt).toBe(resetAt);
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
    expect(next.donors?.[0]?.hsTerritoryExcluded).toBeUndefined();
    expect(next.donors?.[0]?.amount).toBe(50_000);
    const field = buildHighSocietyFieldFromAppState(next);
    expect(field.seats.every((s) => s.widthCm === 300)).toBe(true);
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
    expect(reAdded.donationLinks?.b?.active).toBe(true);
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
  it("defaults all production effects to OFF", () => {
    const fx = defaultHighSocietyFxSettings();
    expect(fx).toEqual({
      frontier: false,
      growFlash: false,
      contestedEdge: false,
      arrowBlade: false,
      strongOutline: false,
    });
    expect(normalizeHighSocietyFxSettings(undefined)).toEqual(fx);
    expect(normalizeHighSocietyFxSettings({})).toEqual(fx);
    expect(normalizeHighSocietySettings(null).fx).toEqual(fx);
  });

  it("only enables effects explicitly set to true", () => {
    expect(
      normalizeHighSocietyFxSettings({
        frontier: true,
        growFlash: false,
      })
    ).toEqual({
      frontier: true,
      growFlash: false,
      contestedEdge: false,
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
    expect(removed.donationLinks?.b?.active).toBe(false);
    expect(removed.donationLinks?.b?.startedAt).toBe(startedAt);

    const reAdded = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: removed,
      nextSettings: normalizeHighSocietySettings({ ...prev, seatMemberIds: ["a", "b"] }),
      members,
      donors: [{ memberId: "b", amount: 10_000, at: 6000 }],
    });
    expect(reAdded.donationLinks?.b?.active).toBe(true);
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

  it("re-enters when memberWidthCm snapshot is 0 but territory expand exists", () => {
    const settings = normalizeHighSocietySettings({
      ...baseSettings,
      seatMemberIds: ["jaki", "subin", "jisu"],
      memberWidthCm: { jaki: 110, jisu: 110, subin: 0 },
      memberWidthDonationSnapshot: { jaki: 10_000, jisu: 10_000, subin: 100_000 },
      memberTerritoryExpand: {
        jaki: { expandLeftCm: 0, expandRightCm: 5 },
        jisu: { expandLeftCm: 5, expandRightCm: 0 },
        subin: { expandLeftCm: 0, expandRightCm: 50 },
      },
    });
    const donors = [
      { id: "d1", name: "x", amount: 10_000, memberId: "jaki", at: 2000, ...hsTerritoryOn },
      { id: "d2", name: "y", amount: 10_000, memberId: "jisu", at: 2000, ...hsTerritoryOn },
      {
        id: "d-subin",
        name: "z",
        amount: 100_000,
        memberId: "subin",
        at: 3000,
        hsPushDir: "right" as const,
        ...hsTerritoryOn,
      },
    ];
    const field = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: settings,
    });
    const subin = field.seats.find((s) => s.id === "subin")!;
    expect(subin.eliminated).toBe(false);
    expect(subin.widthCm).toBeGreaterThan(0);
    expect(subin.expandRightCm).toBe(50);
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

  it("insertHighSocietySeatMemberIdAt places member at chosen index", () => {
    expect(insertHighSocietySeatMemberIdAt(["a", "b", "c"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(insertHighSocietySeatMemberIdAt(["a", "b", "c"], "d", 2)).toEqual(["a", "b", "d", "c"]);
    expect(insertHighSocietySeatMemberIdAt(["a", "b", "c"], "d", 99)).toEqual(["a", "b", "c", "d"]);
    expect(appendHighSocietySeatMemberId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
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

  it("does not sync when territory paused or onRoundEnd", () => {
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
    expect(roundEnd.highSocietySettings?.memberWidthCm).toBeUndefined();
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

  it("seat move left after small reclaim keeps 15cm (no 115cm inflate / neighbor wipe)", () => {
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
    const before = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: settings,
      territoryLogs: [createTerritoryLog("jaki", 1, 15, { pushDir: "right" })],
    });
    expect(before.seats.find((s) => s.id === "jaki")!.widthCm).toBe(15);
    expect(before.seats.find((s) => s.id === "saa")!.widthCm).toBe(100);

    settings = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: settings,
      nextSettings: normalizeHighSocietySettings({
        ...settings,
        seatMemberIds: ["subin", "saa", "jaki", "gana"],
      }),
      members,
      donors,
    });
    const after = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: settings,
      territoryLogs: [createTerritoryLog("jaki", 1, 15, { pushDir: "right" })],
    });
    expect(after.seats.find((s) => s.id === "jaki")!.widthCm).toBe(15);
    expect(after.seats.find((s) => s.id === "saa")!.widthCm).toBe(100);
    expect(after.seats.find((s) => s.id === "jaki")!.widthCm).not.toBe(115);
  });
});
