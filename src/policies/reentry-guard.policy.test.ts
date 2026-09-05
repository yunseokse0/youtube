import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReentryGuard, STANDARD_COOLDOWNS, defaultReentryGuard } from "@policies/reentry-guard.policy";
import { ERROR_CODES } from "@domain/types/error-envelope";

describe("ReentryGuard", () => {
  beforeEach(() => {
    defaultReentryGuard.forceReset();
  });

  it("TR-3.1: 1000ms cooldown 내 2번째 호출은 skip, 1100ms 후 재호출은 실행 (fake timers)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const now = () => Date.now();
    const guard = new ReentryGuard({ nowProvider: now });

    let callCount = 0;
    const fn1 = async () => {
      callCount += 1;
      return callCount;
    };

    const r1 = await guard.guard("x", 1000, fn1);
    expect(r1.tag).toBe("ok");
    expect(r1.tag === "ok" && r1.value).toBe(1);
    expect(callCount).toBe(1);

    vi.setSystemTime(500);
    const r2 = await guard.guard("x", 1000, fn1);
    expect(r2.tag).toBe("err");
    expect(r2.tag === "err" && r2.error.code).toBe(ERROR_CODES.DIN_REENTRY_001);
    expect(callCount).toBe(1);

    vi.setSystemTime(1001);
    const r3 = await guard.guard("x", 1000, fn1);
    expect(r3.tag).toBe("ok");
    expect(r3.tag === "ok" && r3.value).toBe(2);
    expect(callCount).toBe(2);

    vi.useRealTimers();
  });

  it("STANDARD_COOLDOWNS donation 60s, bmode 180s 매핑 확인", () => {
    expect(STANDARD_COOLDOWNS["fetchToonaDonationsSinceLink"]).toBe(60_000);
    expect(STANDARD_COOLDOWNS["bmodeRefreshRoster"]).toBe(180_000);
    expect(STANDARD_COOLDOWNS["pruneStaleBroadcastDonors"]).toBe(60 * 60_000);
  });

  it("isCoolingDown + forceReset 동작", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const guard = new ReentryGuard({ nowProvider: () => Date.now() });

    guard.guardSync("y", 2000, () => 1);

    vi.setSystemTime(1000);
    expect(guard.isCoolingDown("y", 2000).cooling).toBe(true);
    expect(guard.isCoolingDown("y", 2000).remainingMs).toBe(1000);

    guard.forceReset("y");
    expect(guard.isCoolingDown("y", 2000).cooling).toBe(false);

    vi.useRealTimers();
  });
});
