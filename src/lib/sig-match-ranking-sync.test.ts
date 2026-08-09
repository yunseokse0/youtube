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

  it("requires keyword when countAllDonations is false", () => {
    const donors: Donor[] = [
      { id: "d1", name: "fan", amount: 191_000, memberId: "a", at: Date.now(), target: "toon" },
    ];
    const rows = getSigMatchRankings(
      donors,
      members,
      { ...baseSettings, countAllDonations: false },
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
});
