import { describe, expect, it } from "vitest";
import type { Donor } from "@/types";
import {
  detectSuspectBatchStampSeconds,
  donorTimestampsChanged,
  repairDonorTimestamps,
} from "@/lib/donation/repair-donor-timestamps";

describe("repairDonorTimestamps", () => {
  it("detects seconds shared by many donors as batch stamps", () => {
    const batchAt = Date.parse("2026-08-19T13:55:41.000Z");
    const donors = Array.from({ length: 6 }, (_, i) => ({
      id: `d${i}`,
      name: "a",
      amount: 100,
      memberId: "m1",
      at: batchAt,
      target: "toon" as const,
    }));
    const suspect = detectSuspectBatchStampSeconds(donors);
    expect(suspect.has(Math.floor(batchAt / 1000))).toBe(true);
  });

  it("recovers enqueue time embedded in toonation fallback id instead of batch stamp", () => {
    const batchAt = Date.parse("2026-08-19T13:55:41.000Z");
    const realAt = Date.parse("2026-08-19T10:15:32.000Z");
    const donors: Donor[] = [
      {
        id: `toonation:toon-abc-${realAt}-100-0-xyz`,
        name: "후원자",
        amount: 100,
        memberId: "m1",
        at: batchAt,
        target: "toon",
      },
    ];
    const repaired = repairDonorTimestamps(donors, { minClusterSize: 99 });
    expect(repaired[0]?.at).toBe(realAt);
  });

  it("repairs cluster using daily log minimum at", () => {
    const batchAt = Date.parse("2026-08-19T22:15:32.000Z");
    const earlyAt = Date.parse("2026-08-19T19:05:00.000Z");
    const donors: Donor[] = Array.from({ length: 8 }, (_, i) => ({
      id: `toonation:toon-x-${i}`,
      name: `donor${i}`,
      amount: 100,
      memberId: "m1",
      at: batchAt,
      target: "toon" as const,
    }));
    donors[0] = { ...donors[0]!, id: "toonation:toon-target" };
    const log = {
      "2026-08-19": [
        {
          at: "2026-08-19T20:00:00.000Z",
          donors: [{ ...donors[0]!, at: earlyAt }],
        },
      ],
    };
    const repaired = repairDonorTimestamps(donors, { dailyLog: log });
    expect(repaired[0]?.at).toBe(earlyAt);
  });

  it("prefers live reference donor at when not a batch cluster", () => {
    const batchAt = Date.parse("2026-08-19T22:15:32.000Z");
    const listAt = Date.parse("2026-08-19T20:30:00.000Z");
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
    const repaired = repairDonorTimestamps(donors, {
      referenceDonors: [{ ...donors[0]!, at: listAt }],
      minClusterSize: 99,
    });
    expect(repaired[0]?.at).toBe(listAt);
  });
});

describe("donorTimestampsChanged", () => {
  it("returns true when at differs", () => {
    const a: Donor[] = [{ id: "1", name: "a", amount: 1, memberId: "m", at: 1 }];
    const b: Donor[] = [{ id: "1", name: "a", amount: 1, memberId: "m", at: 2 }];
    expect(donorTimestampsChanged(a, b)).toBe(true);
  });
});
