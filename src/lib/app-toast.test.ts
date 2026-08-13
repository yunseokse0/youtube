import { describe, expect, it } from "vitest";
import { formatHsPushDirLabel } from "@/lib/app-toast";

describe("formatHsPushDirLabel", () => {
  it("labels manual and system dirs", () => {
    expect(formatHsPushDirLabel("left", "right")).toBe("← 왼쪽 수동");
    expect(formatHsPushDirLabel("right", "left")).toBe("→ 오른쪽 수동");
    expect(formatHsPushDirLabel("system", "left")).toBe("시스템 기본(←)");
    expect(formatHsPushDirLabel("system", "right")).toBe("시스템 기본(→)");
    expect(formatHsPushDirLabel(null, "left")).toBe("시스템 기본(←)");
  });
});
