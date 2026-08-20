import { describe, expect, it } from "vitest";
import type { Donor, SettlementRecord } from "@/types";
import {
  aggregateMemberDonors,
  buildDailyLogMinAtByDonorId,
  formatExportDateTime,
  recordToMemberDonorsCsv,
  repairSettlementDonorTimestamps,
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

describe("repairSettlementDonorTimestamps", () => {
  it("uses earliest at from daily log snapshots when settlement batch-stamped same time", () => {
    const batchAt = Date.parse("2026-08-19T22:15:32.000Z");
    const earlyAt = Date.parse("2026-08-19T19:05:00.000Z");
    const donors: Donor[] = [
      {
        id: "toonation:toon-abc-1",
        name: "후원자A",
        amount: 1000,
        memberId: "m1",
        at: batchAt,
        target: "toon",
      },
    ];
    const log = {
      "2026-08-19": [
        {
          at: "2026-08-19T20:00:00.000Z",
          total: 1000,
          members: [],
          donors: [{ ...donors[0]!, at: earlyAt }],
        },
        {
          at: "2026-08-19T22:16:00.000Z",
          total: 1000,
          members: [],
          donors: [{ ...donors[0]!, at: batchAt }],
        },
      ],
    };
    const repaired = repairSettlementDonorTimestamps(donors, {
      dailyLog: log,
      settlementCreatedAt: batchAt + 60_000,
    });
    expect(repaired[0]?.at).toBe(earlyAt);
  });

  it("prefers live donor list (referenceDonors) at over settlement snapshot and daily log", () => {
    const batchAt = Date.parse("2026-08-19T22:15:32.000Z");
    const listAt = Date.parse("2026-08-19T20:30:00.000Z");
    const logAt = Date.parse("2026-08-19T19:05:00.000Z");
    const donors: Donor[] = [
      {
        id: "d-live-1",
        name: "후원자A",
        amount: 5000,
        memberId: "m1",
        at: batchAt,
        target: "toon",
      },
    ];
    const repaired = repairSettlementDonorTimestamps(donors, {
      referenceDonors: [{ ...donors[0]!, at: listAt }],
      dailyLog: {
        "2026-08-19": [
          {
            at: "2026-08-19T21:00:00.000Z",
            total: 5000,
            members: [],
            donors: [{ ...donors[0]!, at: logAt }],
          },
        ],
      },
    });
    expect(repaired[0]?.at).toBe(listAt);
  });

  it("parses embedded ISO timestamp from toonation fallback id", () => {
    const iso = "2026-06-04T10:00:00.000Z";
    const wrongAt = Date.parse("2026-08-19T22:15:32.000Z");
    const donors: Donor[] = [
      {
        id: `toonation:fp-${iso}-5000-abc-xyz`,
        name: "후원자",
        amount: 5000,
        memberId: "m1",
        at: wrongAt,
        target: "toon",
      },
    ];
    const repaired = repairSettlementDonorTimestamps(donors, {});
    expect(repaired[0]?.at).toBe(Date.parse(iso));
  });
});

describe("buildDailyLogMinAtByDonorId", () => {
  it("returns minimum at per donor id across log entries", () => {
    const map = buildDailyLogMinAtByDonorId({
      "2026-08-19": [
        {
          at: "2026-08-19T21:00:00.000Z",
          total: 0,
          members: [],
          donors: [{ id: "d1", name: "a", amount: 1, memberId: "m1", at: 3000 }],
        },
        {
          at: "2026-08-19T22:00:00.000Z",
          total: 0,
          members: [],
          donors: [{ id: "d1", name: "a", amount: 1, memberId: "m1", at: 1000 }],
        },
      ],
    });
    expect(map.get("d1")).toBe(1000);
  });
});

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

describe("formatExportDateTime", () => {
  it("formats local time without trailing Z", () => {
    const s = formatExportDateTime(Date.parse("2026-08-05T11:21:41.433Z"));
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(s).not.toContain("Z");
    expect(s).not.toContain("T");
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
    expect(csv).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z/);
  });
});
