import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_CUSTOM_HEADER_LABEL,
  MAX_MEMBER_CUSTOM_CELL_LEN,
  normalizeMemberCustomCells,
  normalizeMemberCustomHeaderLabel,
} from "@/lib/member-custom-cells";

describe("member-custom-cells", () => {
  it("defaults header label to 상벌금", () => {
    expect(normalizeMemberCustomHeaderLabel(undefined)).toBe(DEFAULT_MEMBER_CUSTOM_HEADER_LABEL);
    expect(normalizeMemberCustomHeaderLabel("  ")).toBe("상벌금");
    expect(normalizeMemberCustomHeaderLabel("메모")).toBe("메모");
  });

  it("normalizes custom cells map and drops empties", () => {
    expect(
      normalizeMemberCustomCells({
        a: " +100만원 ",
        b: "",
        c: "  ",
        "": "x",
      })
    ).toEqual({ a: "+100만원" });
  });

  it("truncates long cell text", () => {
    const long = "가".repeat(MAX_MEMBER_CUSTOM_CELL_LEN + 10);
    const out = normalizeMemberCustomCells({ m1: long });
    expect(out.m1?.length).toBe(MAX_MEMBER_CUSTOM_CELL_LEN);
  });
});
