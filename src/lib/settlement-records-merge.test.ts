import { describe, expect, it } from "vitest";
import { mergeSettlementRecords, normalizeSettlementRecords } from "@/lib/settlement";
import type { SettlementRecord } from "@/types";

function stub(title: string, createdAt: number, id?: string): SettlementRecord {
  return {
    id: id || `st_${createdAt}`,
    title,
    createdAt,
    members: [],
    totalGross: 0,
    totalFee: 0,
    totalNet: 0,
    memberPositionsAtSettlement: {},
  };
}

describe("mergeSettlementRecords", () => {
  const now = Date.now();

  it("unions records from local and remote by id", () => {
    const local = [stub("깡깡대전", now - 100_000, "a"), stub("로컬만", now - 50_000, "b")];
    const remote = [stub("상류사회5화", now - 10_000, "c"), stub("깡깡대전", now - 100_000, "a")];
    const merged = mergeSettlementRecords(local, remote);
    expect(merged.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("does not drop local-only records older than 30 seconds", () => {
    const old = stub("깡깡대전", Date.now() - 86_400_000, "old");
    const remote = [stub("최신", Date.now(), "new")];
    const merged = mergeSettlementRecords([old], remote);
    expect(merged.some((r) => r.id === "old")).toBe(true);
    expect(merged.some((r) => r.id === "new")).toBe(true);
  });

  it("prefers newer createdAt when same id conflicts", () => {
    const local = [{ ...stub("v1", now - 2000, "x") }];
    const remote = [{ ...stub("v2", now - 1000, "x") }];
    const merged = mergeSettlementRecords(local, remote);
    expect(merged.find((r) => r.id === "x")?.title).toBe("v2");
  });

  it("normalizes and sorts latest first", () => {
    const merged = mergeSettlementRecords(
      [stub("a", now - 2000)],
      [stub("b", now - 1000)]
    );
    expect(merged[0]?.title).toBe("b");
    expect(normalizeSettlementRecords(merged).length).toBe(2);
  });
});
