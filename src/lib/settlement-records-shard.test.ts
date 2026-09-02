import { describe, expect, it } from "vitest";
import {
  dateKeysFromSettlementMeta,
  groupSettlementRecordsByDate,
  isSettlementMonolithMigratedStub,
  mergeSettlementRecordLists,
  settlementRecordDateKey,
  settlementRecordsShardKvKey,
} from "./settlement-records-shard";
import type { SettlementRecord } from "@/types";

function stubRecord(id: string, createdAt: number): SettlementRecord {
  return {
    id,
    title: id,
    createdAt,
    accountRatio: 0.5,
    toonRatio: 0.5,
    feeRate: 0.033,
    members: [],
    totalGross: 0,
    totalFee: 0,
    totalNet: 0,
  };
}

describe("settlement-records-shard", () => {
  it("builds shard keys", () => {
    expect(settlementRecordsShardKvKey("din", "2026-09-02")).toBe(
      "excel-broadcast-settlement-records-v1:din:2026-09-02"
    );
  });

  it("groups by KST broadcast date", () => {
    const a = stubRecord("a", Date.parse("2026-09-02T01:00:00+09:00"));
    const b = stubRecord("b", Date.parse("2026-09-01T23:00:00+09:00"));
    const map = groupSettlementRecordsByDate([a, b]);
    expect(map.get(settlementRecordDateKey(a))?.map((r) => r.id)).toEqual(["a"]);
    expect(map.get(settlementRecordDateKey(b))?.map((r) => r.id)).toEqual(["b"]);
  });

  it("merges by id preferring newer createdAt", () => {
    const older = stubRecord("x", 100);
    const newer = { ...stubRecord("x", 200), title: "new" };
    const merged = mergeSettlementRecordLists([older], [newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("new");
  });

  it("detects migrated stub and dateKeys", () => {
    expect(isSettlementMonolithMigratedStub({ __migrated: true, dateKeys: ["2026-09-01"] })).toBe(
      true
    );
    expect(dateKeysFromSettlementMeta({ dateKeys: ["2026-09-02", "2026-09-01"] })).toEqual([
      "2026-09-02",
      "2026-09-01",
    ]);
  });
});
