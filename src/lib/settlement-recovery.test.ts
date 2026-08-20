import { describe, expect, it } from "vitest";
import type { DailyLogEntry } from "@/lib/state";
import type { SettlementRecord } from "@/types";
import {
  findOrphanDailyLogEntries,
  recoverMissingSettlementByTitleHint,
  recoverSettlementRecordsFromDailyLog,
  reconstructSettlementFromDailyLogEntry,
  settlementRecordMatchesDailyLogEntry,
  settlementRecordStronglyMatchesDailyLogEntry,
  stableRecoveredSettlementId,
} from "@/lib/settlement-recovery";

describe("settlement-recovery", () => {
  const at = "2026-08-18T14:30:00.000Z";
  const atMs = Date.parse(at);

  const entry: DailyLogEntry = {
    at,
    total: 500_000,
    members: [
      { id: "m1", name: "A", account: 300_000, toon: 0, contribution: 300_000 },
      { id: "m2", name: "B", account: 200_000, toon: 0, contribution: 200_000 },
    ],
    donors: [
      { id: "d1", name: "후원1", amount: 300_000, memberId: "m1", at: atMs - 1000, target: "account" },
      { id: "d2", name: "후원2", amount: 200_000, memberId: "m2", at: atMs - 500, target: "account" },
    ],
  };

  it("matches settlement record to daily log by time and donors", () => {
    const record: SettlementRecord = {
      id: "st_x",
      title: "깡깡대전",
      createdAt: atMs + 2000,
      accountRatio: 0.7,
      toonRatio: 0.6,
      feeRate: 0.033,
      members: [],
      totalGross: 500_000,
      totalFee: 0,
      totalNet: 400_000,
      donors: entry.donors,
    };
    expect(settlementRecordMatchesDailyLogEntry(record, entry)).toBe(true);
  });

  it("reconstructs settlement from orphan daily log entry", () => {
    const rec = reconstructSettlementFromDailyLogEntry(entry, "깡깡대전");
    expect(rec?.title).toBe("깡깡대전");
    expect(rec?.donors).toHaveLength(2);
    expect(rec?.id).toBe(stableRecoveredSettlementId(entry));
    expect(rec!.totalGross).toBeGreaterThan(0);
  });

  it("recovers orphan daily log entries not covered by existing records", () => {
    const dailyLog = { "2026-08-18": [entry] };
    const orphans = findOrphanDailyLogEntries(dailyLog, []);
    expect(orphans).toHaveLength(1);
    const merged = recoverSettlementRecordsFromDailyLog(dailyLog, [], { titleHint: "깡깡대전" });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toContain("깡깡대전");
  });

  it("skips daily log entry already matched by existing settlement", () => {
    const existing: SettlementRecord = {
      id: "st_old",
      title: "깡깡대전",
      createdAt: atMs,
      accountRatio: 0.7,
      toonRatio: 0.6,
      feeRate: 0.033,
      members: [],
      totalGross: 500_000,
      totalFee: 0,
      totalNet: 400_000,
      donors: entry.donors,
    };
    const merged = recoverSettlementRecordsFromDailyLog({ "2026-08-18": [entry] }, [existing]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("st_old");
  });

  it("recovers kkang when daily log was weak-matched to another settlement", () => {
    const otherDonors = [
      { id: "x1", name: "다른1", amount: 250_000, memberId: "m1", at: atMs - 1000, target: "account" as const },
      { id: "x2", name: "다른2", amount: 240_000, memberId: "m2", at: atMs - 500, target: "account" as const },
    ];
    const wrongRecord: SettlementRecord = {
      id: "st_other",
      title: "상류사회5화",
      createdAt: atMs + 60_000,
      accountRatio: 0.7,
      toonRatio: 0.6,
      feeRate: 0.033,
      members: [],
      totalGross: 490_000,
      totalFee: 0,
      totalNet: 390_000,
      donors: otherDonors,
    };
    expect(settlementRecordMatchesDailyLogEntry(wrongRecord, entry)).toBe(true);
    expect(settlementRecordStronglyMatchesDailyLogEntry(wrongRecord, entry)).toBe(false);

    const orphans = findOrphanDailyLogEntries({ "2026-08-18": [entry] }, [wrongRecord]);
    expect(orphans).toHaveLength(1);

    const merged = recoverSettlementRecordsFromDailyLog(
      { "2026-08-18": [entry] },
      [wrongRecord],
      { titleHint: "깡깡대전" }
    );
    expect(merged.some((r) => r.title.includes("깡깡"))).toBe(true);
    expect(merged).toHaveLength(2);
  });

  it("renames strongly matched record when title hint missing", () => {
    const existing: SettlementRecord = {
      id: "st_old",
      title: "2026-08-18 정산",
      createdAt: atMs,
      accountRatio: 0.7,
      toonRatio: 0.6,
      feeRate: 0.033,
      members: [],
      totalGross: 500_000,
      totalFee: 0,
      totalNet: 400_000,
      donors: entry.donors,
    };
    const merged = recoverMissingSettlementByTitleHint(
      { "2026-08-18": [entry] },
      [existing],
      "깡깡대전"
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("깡깡대전");
  });
});
