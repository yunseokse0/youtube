import { describe, expect, it } from "vitest";
import {
  buildHighSocietyFieldFromMembers,
  buildHighSocietyTerritory,
  buildHighSocietyZones,
  donationToExpandCm,
  formatCm,
  formatHighSocietyTimer,
  formatManWon,
  HIGH_SOCIETY_DEFAULT_FIELD_CM,
  HIGH_SOCIETY_TEST_MEMBERS,
  parseHighSocietyBarStyle,
  parseHighSocietyRound,
  parseHighSocietySplit,
  parseHighSocietyTerritoryUpdateMode,
  normalizeHighSocietySettings,
  fieldCmFromStartPerMember,
  startCmFromField,
  parseHighSocietyFieldCm,
  resolveHighSocietyField,
  buildHighSocietyFieldFromAppState,
} from "./high-society";

describe("high-society rule field", () => {
  it("converts donation with 1만 floor × 5cm", () => {
    expect(donationToExpandCm(0)).toBe(0);
    expect(donationToExpandCm(9999)).toBe(0);
    expect(donationToExpandCm(10000)).toBe(5);
    expect(donationToExpandCm(16900)).toBe(5);
    expect(donationToExpandCm(100000)).toBe(50);
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
  });

  it("realtime field grows/shrinks neighbors when middle push dir changes", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 100_000, toon: 0, operating: false },
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
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 100_000,
          memberId: "b",
          target: "account",
          at: 1,
          hsPushDir: "right",
        },
      ],
      highSocietySettings: baseSettings,
    });
    const leftPush = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 100_000,
          memberId: "b",
          target: "account",
          at: 1,
          hsPushDir: "left",
        },
      ],
      highSocietySettings: baseSettings,
    });
    expect(rightPush.seats[1]!.widthCm).toBe(350);
    expect(rightPush.seats[2]!.widthCm).toBe(250);
    expect(leftPush.seats[1]!.widthCm).toBe(350);
    expect(leftPush.seats[0]!.widthCm).toBe(250);
    expect(leftPush.seats[2]!.widthCm).toBe(300);
  });
});
