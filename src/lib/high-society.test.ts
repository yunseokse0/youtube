import { describe, expect, it } from "vitest";
import {
  buildHighSocietyFieldFromMembers,
  buildHighSocietyTerritory,
  buildHighSocietyZones,
  detectHighSocietyGrowFlashSeatIds,
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
  normalizeHighSocietyFxSettings,
  defaultHighSocietyFxSettings,
  highSocietyFxToHsFxParam,
  parseHighSocietyFxFromHsFxParam,
  mergeHighSocietyDonationLinksOnSettingsChange,
  markDonorsHsTerritoryExcluded,
  fieldCmFromStartPerMember,
  startCmFromField,
  parseHighSocietyFieldCm,
  resolveHighSocietyField,
  resolveHighSocietyStartCmPerMember,
  resolveHighSocietyEffectiveFieldCm,
  buildHighSocietyFieldFromAppState,
} from "./high-society";

describe("high-society rule field", () => {
  it("converts donation with 1만 floor × 5cm", () => {
    expect(donationToExpandCm(0)).toBe(0);
    expect(donationToExpandCm(9999)).toBe(0);
    expect(donationToExpandCm(10000)).toBe(5);
    expect(donationToExpandCm(16900)).toBe(5);
    /** 2만6천원 → 천원(6천) 버림 → 2만원 = 10cm */
    expect(donationToExpandCm(26_000)).toBe(10);
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

  it("filters donors by donationLinks startedAt when enabled", () => {
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
    const beforeStart = buildHighSocietyFieldFromAppState({
      members,
      donors: [
        {
          id: "d-old",
          name: "후원",
          amount: 100_000,
          memberId: "b",
          target: "account",
          at: 1000,
          hsPushDir: "right",
        },
      ],
      highSocietySettings: baseSettings,
    });
    const afterStart = buildHighSocietyFieldFromAppState({
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
    expect(beforeStart.seats[1]!.widthCm).toBe(300);
    expect(afterStart.seats[1]!.widthCm).toBe(350);
  });

  it("keeps territory when mode is toggled off (donors not wiped from aggregation)", () => {
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
      },
    ];
    const onSettings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      defaultMiddlePush: "right",
      donationLinks: { b: { active: true, startedAt: 5000 } },
    });
    const offSettings = normalizeHighSocietySettings({
      ...onSettings,
      enabled: false,
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

  it("re-ON preserves donationLinks startedAt (territory baseline not reset)", () => {
    const members = [
      { id: "a", name: "A", account: 0, toon: 0, operating: false },
      { id: "b", name: "B", account: 0, toon: 0, operating: false },
      { id: "c", name: "C", account: 0, toon: 0, operating: false },
      { id: "d", name: "D", account: 0, toon: 0, operating: false },
    ];
    const prev = normalizeHighSocietySettings({
      enabled: false,
      seatMemberIds: ["a", "b", "c", "d"],
      donationLinks: { b: { active: true, startedAt: 5000 } },
    });
    const next = mergeHighSocietyDonationLinksOnSettingsChange({
      prevSettings: prev,
      nextSettings: normalizeHighSocietySettings({ ...prev, enabled: true }),
      members,
      now: 99_000,
    });
    expect(next.donationLinks?.b?.startedAt).toBe(5000);
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
        },
      ],
      highSocietySettings: settings,
    });
    expect(oneSmall.seats[0]!.widthCm).toBe(105);
    expect(oneSmall.seats[1]!.widthCm).toBe(95);
  });

  it("excludes pre-ON donor rows when startedAt is set on first ON", () => {
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

    const newDonor = buildHighSocietyFieldFromAppState({
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
    expect(newDonor.seats[1]!.widthCm).toBe(305);
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
      },
    ];
    const prev = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      round: 2,
      donationLinks: { b: { active: true, startedAt: 5000 } },
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
      donors,
      highSocietySettings: next,
    });
    expect(beforeReset.seats[1]!.widthCm).toBe(350);
    expect(afterReset.seats[1]!.widthCm).toBe(300);
    expect(donors).toHaveLength(1);
    expect(donors[0]!.amount).toBe(100_000);
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
});
