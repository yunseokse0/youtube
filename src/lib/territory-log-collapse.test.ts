import { describe, expect, it } from "vitest";
import { createTerritoryLog } from "@/lib/territory-utils";
import { collapseNearDuplicateTerritoryLogs, isNearDuplicateTerritoryLog } from "@/lib/territory-log-collapse";

describe("territory-log-collapse", () => {
  it("treats same team/cm within 800ms as a duplicate", () => {
    const a = createTerritoryLog("m1", 1, 300, { now: 1000, teamId: "ta", pushDir: "right" });
    const b = createTerritoryLog("m1", 1, 300, { now: 1200, teamId: "ta", pushDir: "right" });
    expect(isNearDuplicateTerritoryLog([a], b)).toBe(true);
    expect(collapseNearDuplicateTerritoryLogs([a, b]).map((l) => l.id)).toEqual([a.id]);
  });

  it("keeps two identical amounts that are seconds apart", () => {
    const a = createTerritoryLog("m1", 1, 100, { now: 1000, teamId: "ta", pushDir: "right" });
    const b = createTerritoryLog("m1", 1, 100, { now: 3000, teamId: "ta", pushDir: "right" });
    expect(isNearDuplicateTerritoryLog([a], b)).toBe(false);
    expect(collapseNearDuplicateTerritoryLogs([a, b]).map((l) => l.id).sort()).toEqual(
      [a.id, b.id].sort()
    );
  });
});
