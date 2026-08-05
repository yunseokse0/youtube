import { describe, expect, it } from "vitest";
import type { Donor, SettlementRecord } from "@/types";
import {
  aggregateMemberDonors,
  recordToMemberDonorsCsv,
  resolveSettlementDonors,
} from "@/lib/settlement-donor-export";

const baseRecord: SettlementRecord = {
  id: "st_test",
  title: "테스트 정산",
  createdAt: new Date("2026-07-29T12:00:00.000Z").getTime(),
  accountRatio: 0.7,
  toonRatio: 0.6,
  feeRate: 0.033,
  members: [
    {
      memberId: "m1",
      name: "A",
      realName: "",
      account: 0,
      toon: 0,
      accountRatio: 0.7,
      toonRatio: 0.6,
      accountApplied: 0,
      toonApplied: 0,
      gross: 0,
      fee: 0,
      net: 0,
    },
    {
      memberId: "m2",
      name: "B",
      realName: "",
      account: 0,
      toon: 0,
      accountRatio: 0.7,
      toonRatio: 0.6,
      accountApplied: 0,
      toonApplied: 0,
      gross: 0,
      fee: 0,
      net: 0,
    },
  ],
  totalGross: 0,
  totalFee: 0,
  totalNet: 0,
};

describe("resolveSettlementDonors", () => {
  it("uses donors snapshot on record when present", () => {
    const donors: Donor[] = [
      { id: "d1", name: "후원자1", amount: 1000, memberId: "m1", at: 1 },
    ];
    expect(resolveSettlementDonors({ ...baseRecord, donors }, {})).toEqual(donors);
  });

  it("falls back to daily log entry before settlement time", () => {
    const donors: Donor[] = [
      { id: "d1", name: "후원자1", amount: 5000, memberId: "m1", at: 1, target: "toon" },
    ];
    const log = {
      "2026-07-29": [
        {
          at: "2026-07-29T11:00:00.000Z",
          total: 5000,
          members: [],
          donors,
        },
      ],
    };
    expect(resolveSettlementDonors(baseRecord, log)).toEqual(donors);
  });
});

describe("aggregateMemberDonors", () => {
  it("groups by member and donor name with channel split", () => {
    const donors: Donor[] = [
      { id: "d1", name: "철수", amount: 10000, memberId: "m1", at: 1, target: "account" },
      { id: "d2", name: "철수", amount: 5000, memberId: "m1", at: 2, target: "toon" },
      { id: "d3", name: "영희", amount: 3000, memberId: "m2", at: 3, target: "toon" },
    ];
    const rows = aggregateMemberDonors(baseRecord, donors);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.memberId === "m1" && r.donorName === "철수");
    expect(a?.totalAmount).toBe(15000);
    expect(a?.count).toBe(2);
    expect(a?.accountAmount).toBe(10000);
    expect(a?.toonAmount).toBe(5000);
  });
});

describe("recordToMemberDonorsCsv", () => {
  it("includes donation message in detail rows", () => {
    const donors: Donor[] = [
      {
        id: "d1",
        name: "익명",
        amount: 10000,
        memberId: "m1",
        at: Date.parse("2026-07-29T11:30:00.000Z"),
        target: "account",
        message: "계좌 응원합니다",
      },
    ];
    const csv = recordToMemberDonorsCsv(baseRecord, donors);
    expect(csv).toContain("메시지");
    expect(csv).toContain("계좌 응원합니다");
  });
});
