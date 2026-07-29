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
});
