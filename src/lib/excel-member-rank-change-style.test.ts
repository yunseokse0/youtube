import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCEL_MEMBER_RANK_CHANGE_STYLE,
  normalizeExcelMemberRankChangeStyle,
  resolveExcelMemberRankChangeStyle,
} from "@/lib/excel-member-rank-change-style";

describe("excel-member-rank-change-style", () => {
  it("uses defaults when empty", () => {
    expect(normalizeExcelMemberRankChangeStyle({})).toEqual(DEFAULT_EXCEL_MEMBER_RANK_CHANGE_STYLE);
  });

  it("clamps font sizes", () => {
    const s = normalizeExcelMemberRankChangeStyle({
      memberRankChangeNameSize: "999",
      memberRankChangeRankSize: "10",
    });
    expect(s.nameSizePx).toBe(72);
    expect(s.rankSizePx).toBe(32);
  });

  it("merges URL params before ready", () => {
    const sp = new URLSearchParams({
      memberRankChangeNameSize: "36",
      memberRankChangeRankColor: "#ff0000",
    });
    const s = resolveExcelMemberRankChangeStyle(sp, {}, { ready: false });
    expect(s.nameSizePx).toBe(36);
    expect(s.rankColor).toBe("#ff0000");
  });

  it("prefers preset when ready", () => {
    const sp = new URLSearchParams({ memberRankChangeNameSize: "36" });
    const s = resolveExcelMemberRankChangeStyle(
      sp,
      { memberRankChangeNameSize: "22" },
      { ready: true }
    );
    expect(s.nameSizePx).toBe(22);
  });
});
