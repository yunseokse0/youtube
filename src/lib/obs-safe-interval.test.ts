import { describe, expect, it, vi } from "vitest";
import { createObsSafeInterval } from "@/lib/obs-safe-interval";

describe("createObsSafeInterval", () => {
  it("falls back to setInterval when Worker is unavailable", () => {
    const original = globalThis.Worker;
    // @ts-expect-error test stub
    globalThis.Worker = undefined;
    vi.useFakeTimers();
    const fn = vi.fn();
    const stop = createObsSafeInterval(fn, 1000);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    globalThis.Worker = original;
  });
});
