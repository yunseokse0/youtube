import { describe, expect, it } from "vitest";
import { getSigMatchRankings } from "./settlement-utils";
import type { Donor, Member, SigMatchSettings } from "@/types";

const members: Member[] = [
  { id: "a", name: "A", account: 0, toon: 0 },
  { id: "b", name: "B", account: 0, toon: 0 },
];

describe("getSigMatchRankings countAllDonations", () => {
  const baseSettings: SigMatchSettings = {
    isActive: true,
    targetCount: 100,
    title: "벌칙대전",
    keyword: "시그",
    signatureAmounts: [100],
    scoringMode: "amount",
    countAllDonations: true,
    incentivePerPoint: 1000,
    sigMatchPools: [],
    participantMemberIds: [],
  };

  it("counts all donations in amount mode when countAllDonations is true", () => {
    const donors: Donor[] = [
      { id: "d1", name: "fan", amount: 191_000, memberId: "a", at: Date.now(), target: "toon" },
    ];
    const rows = getSigMatchRankings(donors, members, baseSettings, {}, {});
    expect(rows.find((r) => r.memberId === "a")?.score).toBe(191_000);
  });

  it("requires keyword when countAllDonations is false and donation link is OFF", () => {
    const donors: Donor[] = [
      { id: "d1", name: "fan", amount: 191_000, memberId: "a", at: Date.now(), target: "toon" },
    ];
    const rows = getSigMatchRankings(
      donors,
      members,
      { ...baseSettings, countAllDonations: false, donationLinks: { a: { active: false } } },
      {},
      {}
    );
    expect(rows.find((r) => r.memberId === "a")?.score).toBe(0);
  });

  it("ignores member donations when donation link is OFF", () => {
    const donors: Donor[] = [
      { id: "d1", name: "fan", amount: 50_000, memberId: "a", at: 2_000, target: "toon" },
      { id: "d2", name: "fan2", amount: 80_000, memberId: "b", at: 2_000, target: "toon" },
    ];
    const rows = getSigMatchRankings(
      donors,
      members,
      {
        ...baseSettings,
        donationLinks: {
          a: { active: false },
          b: { active: true, startedAt: 1_000 },
        },
      },
      {},
      {}
    );
    expect(rows.find((r) => r.memberId === "a")?.score).toBe(0);
    expect(rows.find((r) => r.memberId === "b")?.score).toBe(80_000);
  });

  it("counts linked member donations even when countAllDonations is false", () => {
    const donors: Donor[] = [
      { id: "d1", name: "fan", amount: 10_000, memberId: "a", at: 2_000, target: "account" },
    ];
    const rows = getSigMatchRankings(
      donors,
      members,
      {
        ...baseSettings,
        scoringMode: "count",
        countAllDonations: false,
        donationLinks: { a: { active: true, startedAt: 1_000 } },
      },
      {},
      {}
    );
    expect(rows.find((r) => r.memberId === "a")?.score).toBe(1);
    expect(rows.find((r) => r.memberId === "a")?.matchedAmount).toBe(10_000);
  });

  it("falls back to member excel totals when donors list is empty but link is ON", () => {
    const membersWithAmount: Member[] = [
      { id: "a", name: "A", account: 10_000, toon: 0, contribution: 10_000 },
      { id: "b", name: "B", account: 0, toon: 0, contribution: 0 },
    ];
    const rows = getSigMatchRankings(
      [],
      membersWithAmount,
      {
        ...baseSettings,
        donationLinks: { a: { active: true, startedAt: 1_000 } },
      },
      {},
      {}
    );
    expect(rows.find((r) => r.memberId === "a")?.score).toBe(10_000);
  });

  it("ignores donations before donationLink startedAt", () => {
    const donors: Donor[] = [
      { id: "d1", name: "fan", amount: 10_000, memberId: "a", at: 500, target: "toon" },
      { id: "d2", name: "fan", amount: 20_000, memberId: "a", at: 2_000, target: "toon" },
    ];
    const rows = getSigMatchRankings(
      donors,
      members,
      {
        ...baseSettings,
        donationLinks: { a: { active: true, startedAt: 1_000 } },
      },
      {},
      {}
    );
    expect(rows.find((r) => r.memberId === "a")?.score).toBe(20_000);
  });

  it("does not fall back to excel totals when donor rows exist but are before startedAt", () => {
    const membersWithAmount: Member[] = [
      { id: "a", name: "A", account: 10_000, toon: 0, contribution: 10_000 },
    ];
    const donors: Donor[] = [
      { id: "d1", name: "fan", amount: 10_000, memberId: "a", at: 500, target: "toon" },
    ];
    const rows = getSigMatchRankings(
      donors,
      membersWithAmount,
      {
        ...baseSettings,
        donationLinks: { a: { active: true, startedAt: 1_000 } },
      },
      {},
      {}
    );
    expect(rows.find((r) => r.memberId === "a")?.score).toBe(0);
  });

  it("applies negative manual adjust as deduction from donation score", () => {
    const donors: Donor[] = [
      { id: "d1", name: "fan", amount: 50_000, memberId: "a", at: Date.now(), target: "toon" },
    ];
    const rows = getSigMatchRankings(donors, members, baseSettings, { a: -20_000 }, {});
    expect(rows.find((r) => r.memberId === "a")?.manualAdjust).toBe(-20_000);
    expect(rows.find((r) => r.memberId === "a")?.score).toBe(30_000);
  });
});
