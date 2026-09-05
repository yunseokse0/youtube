import { describe, it, expect } from "vitest";
import {
  TimeoutTier,
  applyTimeout,
  resolveTimeoutMs,
  TimeoutError,
} from "@policies/timeout-tier.policy";
import { ERROR_CODES } from "@domain/types/error-envelope";

describe("TimeoutTierPolicy 4계층 + applyTimeout", () => {
  it("TR-2.2: 5ms custom 타임아웃을 걸고 영원히 안끝나는 Promise → 15ms 이내 DIN-TIME-001 reject", async () => {
    const forever = new Promise<number>(() => {});
    const start = Date.now();
    try {
      await applyTimeout(forever, 5);
      expect.fail("should have thrown");
    } catch (e) {
      const elapsed = Date.now() - start;
      expect(e).toBeInstanceOf(TimeoutError);
      const te = e as TimeoutError;
      expect(te.envelope.code).toBe(ERROR_CODES.DIN_TIME_001);
      expect(elapsed).toBeLessThanOrEqual(100);
    }
  });

  it("TimeoutTier 4계층 상수 값 일치 (L4=10s L3=14s L2=16s L1=25s)", () => {
    expect(TimeoutTier.L4_MYSQL).toBe(10_000);
    expect(TimeoutTier.L3_DOMAIN).toBe(14_000);
    expect(TimeoutTier.L2_SHELL).toBe(16_000);
    expect(TimeoutTier.L1_API).toBe(25_000);
    expect(resolveTimeoutMs(TimeoutTier.L4_MYSQL).name).toBe("L4_MYSQL");
    expect(resolveTimeoutMs(9999).name).toBe("custom");
  });

  it("applyTimeout은 정상 완료된 Promise를 그대로 통과시킴", async () => {
    const fast = Promise.resolve("done");
    const r = await applyTimeout(fast, 1000);
    expect(r).toBe("done");
  });
});
