import { describe, it, expect, vi, beforeEach } from "vitest";
import { CircuitBreaker, type CircuitState } from "@policies/circuit-breaker.policy";
import { ERROR_CODES } from "@domain/types/error-envelope";

describe("CircuitBreaker", () => {
  const makeFailing = (msg = "boom") => async () => Promise.reject(new Error(msg));
  const makeSuccess = <T>(v: T) => async () => v;

  it("TR-3.2: 3연속 실패시 OPEN, 4번째 호출은 fn 호출 없이 DIN-CB-001 reject", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openWindowMs: 5000 });
    let fnCalls = 0;
    const failFn = async () => {
      fnCalls += 1;
      throw new Error("fail");
    };

    for (let i = 0; i < 3; i++) {
      const r = await cb.execute(`f${i}`, failFn);
      expect(r.tag).toBe("err");
    }
    expect(fnCalls).toBe(3);
    expect(cb.snapshot().state).toBe("OPEN");

    const r4 = await cb.execute("f4", failFn);
    expect(r4.tag).toBe("err");
    expect(r4.tag === "err" && r4.error.code).toBe(ERROR_CODES.DIN_CB_001);
    expect(fnCalls).toBe(3);
  });

  it("OPEN → 5초 경과 → HALF_OPEN → 성공시 CLOSED 회귀", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cb = new CircuitBreaker({ failureThreshold: 2, openWindowMs: 5000, nowProvider: () => Date.now() });

    await cb.execute("a", makeFailing());
    await cb.execute("b", makeFailing());
    expect(cb.getState()).toBe("OPEN" as CircuitState);

    vi.setSystemTime(4999);
    expect(cb.getState()).toBe("OPEN" as CircuitState);

    vi.setSystemTime(5001);
    expect(cb.getState()).toBe("HALF_OPEN" as CircuitState);

    const r = await cb.execute("c", makeSuccess(42));
    expect(r.tag).toBe("ok");
    expect(r.tag === "ok" && r.value).toBe(42);
    expect(cb.getState()).toBe("CLOSED" as CircuitState);

    vi.useRealTimers();
  });

  it("HALF_OPEN → 실패시 다시 OPEN + consecutive threshold 회복", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cb = new CircuitBreaker({ failureThreshold: 2, openWindowMs: 1000, nowProvider: () => Date.now() });

    await cb.execute("1", makeFailing());
    await cb.execute("2", makeFailing());
    expect(cb.getState()).toBe("OPEN" as CircuitState);

    vi.setSystemTime(1001);
    expect(cb.getState()).toBe("HALF_OPEN" as CircuitState);

    const r = await cb.execute("3", makeFailing());
    expect(r.tag).toBe("err");
    expect(cb.getState()).toBe("OPEN" as CircuitState);
    expect(cb.snapshot().consecutiveFailures).toBe(2);

    vi.useRealTimers();
  });

  it("forceClose / forceOpen 수동 제어", () => {
    const cb = new CircuitBreaker();
    cb.forceOpen();
    expect(cb.getState()).toBe("OPEN" as CircuitState);
    cb.forceClose();
    expect(cb.getState()).toBe("CLOSED" as CircuitState);
  });
});
