import { describe, expect, it } from "vitest";
import {
  filterSettlementRecordsByDeleteLogs,
  isDailyLogEntryBlockedByDeleteLog,
  isSettlementRecordRevivedFromDeleteLog,
} from "./settlement-delete-tombstone";
import type { SettlementDeleteLog, SettlementRecord } from "@/types";

const stubRecord = (id: string, title: string, createdAt: number, totalNet: number): SettlementRecord =>
  ({
    id,
    title,
    createdAt,
    totalNet,
    accountRatio: 0.7,
    toonRatio: 0.6,
    feeRate: 0.033,
    members: [],
    totalGross: totalNet,
    totalFee: 0,
    memberPositionsAtSettlement: {},
  }) as SettlementRecord;

describe("settlement delete tombstone", () => {
  it("filters deleted record id from list", () => {
    const logs: SettlementDeleteLog[] = [
      {
        recordId: "st_del_1",
        title: "테스트 정산",
        createdAt: 1000,
        deletedAt: 2000,
        totalNet: 50000,
      },
    ];
    const records = [
      stubRecord("st_del_1", "테스트 정산", 1000, 50000),
      stubRecord("st_keep", "유지", 1000, 10000),
    ];
    const filtered = filterSettlementRecordsByDeleteLogs(records, logs);
    expect(filtered.map((r) => r.id)).toEqual(["st_keep"]);
  });

  it("blocks daily log orphan that matches deleted settlement time", () => {
    const logs: SettlementDeleteLog[] = [
      {
        recordId: "st_old",
        title: "2026-08-20 방송",
        createdAt: 1_755_686_400_000,
        deletedAt: Date.now(),
        totalNet: 100000,
      },
    ];
    expect(
      isDailyLogEntryBlockedByDeleteLog(
        { at: new Date(1_755_686_400_000).toISOString(), total: 100000, members: [], donors: [] },
        logs
      )
    ).toBe(true);
  });

  it("detects revived record with new id but same title and createdAt", () => {
    const logs: SettlementDeleteLog[] = [
      {
        recordId: "st_old",
        title: "깡깡대전 2화",
        createdAt: 1_786_794_263_000,
        deletedAt: Date.now(),
        totalNet: 566000,
      },
    ];
    expect(
      isSettlementRecordRevivedFromDeleteLog(
        stubRecord("st_recovered_new", "깡깡대전 2화", 1_786_794_263_000, 566000),
        logs
      )
    ).toBe(true);
  });
});
