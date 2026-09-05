import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryMeter, METER_WINDOW_MS } from "@infra/metrics/memory-meter";
import { InstrumentedIO } from "@infra/io/instrumented-io";
import { TimeoutTier } from "@policies/timeout-tier.policy";

describe("MemoryMeter + InstrumentedIO (TR-2.3: 4가지 장식 코드 hit)", () => {
  let meter: MemoryMeter;
  let io: InstrumentedIO;

  beforeEach(() => {
    meter = new MemoryMeter();
    io = new InstrumentedIO(meter);
  });

  it("InstrumentedIO 4장식: ① timeout ② p95 latency ③ 실패 counter ④ pool leak 기록 모두 hit", async () => {
    let poolLeakFlag = false;
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 5));
    const fail = () => Promise.reject(new Error("boom"));
    const hang = () => new Promise<never>(() => {});

    const r1 = await io.callResult("fast-op", TimeoutTier.L4_MYSQL, slow, {
      poolLeakDetector: () => {
        poolLeakFlag = true;
        return poolLeakFlag;
      },
    });
    expect(r1.tag).toBe("ok");

    let caughtErr: any = null;
    try {
      await io.callRaw("fail-op", 500, fail);
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(Error);

    let caughtTimeout: any = null;
    try {
      await io.callRaw("hang-op", 10, hang);
    } catch (e) {
      caughtTimeout = e;
    }
    expect(caughtTimeout?.name).toBe("TimeoutError");

    expect(meter.getCounterSum("io_success")).toBeGreaterThanOrEqual(1);
    expect(meter.getCounterSum("io_failure")).toBeGreaterThanOrEqual(1);
    expect(meter.getCounterSum("io_timeout")).toBeGreaterThanOrEqual(1);
    expect(meter.getCounterSum("pool_leak")).toBe(1);

    const p95 = meter.getLatencyP95(`fast-op:${"L4_MYSQL"}`);
    expect(p95).not.toBeNull();
    expect(typeof p95).toBe("number");
  });

  it("MemoryMeter 60초 window prune 동작 (fake time with vi.setSystemTime)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const m = new MemoryMeter();
    m.incrementCounter("dedup_tp", 1);
    m.incrementCounter("dedup_fp", 1);

    vi.setSystemTime(METER_WINDOW_MS - 1);
    expect(m.getCounterSum("dedup_tp")).toBe(1);
    expect(m.getCounterSum("dedup_fp")).toBe(1);

    vi.setSystemTime(METER_WINDOW_MS + 1);
    expect(m.getCounterSum("dedup_tp")).toBe(0);
    expect(m.getCounterSum("dedup_fp")).toBe(0);

    const snap = m.snapshot();
    expect(snap.counters["dedup_tp"]).toBe(0);

    vi.useRealTimers();
  });
});
