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
  parseHighSocietySplit,
  resolveHighSocietyField,
} from "./high-society";

describe("high-society rule field", () => {
  it("converts donation with 1만 floor × 5cm", () => {
    expect(donationToExpandCm(0)).toBe(0);
    expect(donationToExpandCm(9999)).toBe(0);
    expect(donationToExpandCm(10000)).toBe(5);
    expect(donationToExpandCm(16900)).toBe(5);
    expect(donationToExpandCm(100000)).toBe(50);
  });

  it("starts equal when no donations", () => {
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

  it("B can put all expansion to the left", () => {
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

  it("maps members A→D in array order", () => {
    const { seats, leader } = buildHighSocietyFieldFromMembers(HIGH_SOCIETY_TEST_MEMBERS, {
      split: { bLeft: 0.5, cLeft: 0.5 },
    });
    expect(seats.map((s) => s.letter)).toEqual(["A", "B", "C", "D"]);
    expect(seats[0]!.name).toBe("금수저");
    expect(leader?.letter).toBeTruthy();
    const sum = seats.reduce((s, x) => s + x.widthCm, 0);
    expect(sum).toBeCloseTo(HIGH_SOCIETY_DEFAULT_FIELD_CM, 0);
  });

  it("parses split and default bar style field", () => {
    expect(parseHighSocietyBarStyle("")).toBe("field");
    expect(parseHighSocietyBarStyle("share")).toBe("share");
    expect(parseHighSocietySplit("70", "30")).toEqual({ bLeft: 0.7, cLeft: 0.3 });
    expect(parseHighSocietySplit("0.2", "0.8")).toEqual({ bLeft: 0.2, cLeft: 0.8 });
    expect(formatCm(305)).toBe("305cm");
  });
});

describe("high-society territory (aux styles)", () => {
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
});
