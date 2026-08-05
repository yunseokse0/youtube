import { describe, expect, it } from "vitest";
import {
  fitRankPositionLabelsToMemberCount,
  normalizeRankPositionLabels,
} from "@/lib/state";

describe("rankPositionLabels member-count fit", () => {
  it("does not force length 12", () => {
    expect(normalizeRankPositionLabels(["대표", "이사"]).length).toBe(2);
    expect(normalizeRankPositionLabels(null)).toEqual(["대표"]);
  });

  it("fits labels to member count", () => {
    expect(fitRankPositionLabelsToMemberCount(["대표", "이사", "부장"], 2)).toEqual([
      "대표",
      "이사",
    ]);
    expect(fitRankPositionLabelsToMemberCount(["대표"], 4)).toEqual(["대표", "", "", ""]);
    expect(fitRankPositionLabelsToMemberCount(["대표"], 7)).toHaveLength(7);
  });
});
