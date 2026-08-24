import { describe, expect, it } from "vitest";
import {
  DEFAULT_DONOR_RANKINGS_FULL_THEME,
  DEFAULT_DONOR_RANKINGS_THEME,
  isDefaultLikeDonorRankingsTheme,
} from "./state";

describe("isDefaultLikeDonorRankingsTheme", () => {
  it("treats default theme as default-like", () => {
    expect(isDefaultLikeDonorRankingsTheme({ ...DEFAULT_DONOR_RANKINGS_THEME })).toBe(true);
  });

  it("detects customized sizes/colors", () => {
    expect(
      isDefaultLikeDonorRankingsTheme({
        ...DEFAULT_DONOR_RANKINGS_THEME,
        titleText: "TOP 후원자",
        titleSize: 47,
        nameColor: "#1e3a5f",
      })
    ).toBe(false);
  });

  it("uses full-theme defaults when provided", () => {
    expect(
      isDefaultLikeDonorRankingsTheme(
        { ...DEFAULT_DONOR_RANKINGS_FULL_THEME },
        DEFAULT_DONOR_RANKINGS_FULL_THEME
      )
    ).toBe(true);
    expect(
      isDefaultLikeDonorRankingsTheme(
        { ...DEFAULT_DONOR_RANKINGS_FULL_THEME, rowSize: 40 },
        DEFAULT_DONOR_RANKINGS_FULL_THEME
      )
    ).toBe(false);
  });

  it("clamps compact theme top above 10 down to 10", () => {
    expect(
      isDefaultLikeDonorRankingsTheme({
        ...DEFAULT_DONOR_RANKINGS_THEME,
        top: 20,
      })
    ).toBe(true);
  });
});
