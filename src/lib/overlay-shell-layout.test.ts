import { describe, expect, it } from "vitest";
import { isOverlayToolsHubPath } from "@/lib/overlay-shell-layout";

describe("isOverlayToolsHubPath", () => {
  it("pathname 없으면 방송 오버레이로 본다 (hydration 셸 분기)", () => {
    expect(isOverlayToolsHubPath(null)).toBe(false);
    expect(isOverlayToolsHubPath("")).toBe(false);
  });

  it("후원순위·엑셀표는 허브가 아니다", () => {
    expect(isOverlayToolsHubPath("/overlay/donor-rankings")).toBe(false);
    expect(isOverlayToolsHubPath("/overlay")).toBe(false);
  });

  it("점검 허브·데모만 true", () => {
    expect(isOverlayToolsHubPath("/overlay/dev")).toBe(true);
    expect(isOverlayToolsHubPath("/overlay/demo")).toBe(true);
  });
});
