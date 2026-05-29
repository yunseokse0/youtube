import { describe, expect, it } from "vitest";
import { formatDonorsAmount, formatWonFull, roundToThousand } from "@/lib/state";

describe("donors amount full format", () => {
  it("roundToThousand still rounds to nearest 1000 (legacy helper)", () => {
    expect(roundToThousand(24500)).toBe(25000);
  });

  it("formatDonorsAmount full shows exact won (no thousand rounding)", () => {
    expect(formatDonorsAmount(24500, "full")).toBe("24,500");
    expect(formatDonorsAmount(24500, "full", "ko-KR")).toBe("24,500");
  });

  it("formatWonFull matches full donors format", () => {
    expect(formatWonFull(24500)).toBe(formatDonorsAmount(24500, "full"));
  });

  it("short format uses man-thousand shorthand", () => {
    expect(formatDonorsAmount(24500, "short")).not.toBe("24,500");
  });
});

describe("GoalBar full format (via formatDonorsAmount)", () => {
  it("goal current/goal labels use exact won in full mode", () => {
    expect(formatDonorsAmount(2_450_000, "full")).toBe("2,450,000");
    expect(formatDonorsAmount(24_500, "full")).toBe("24,500");
  });
});
