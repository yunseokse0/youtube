import { describe, expect, it, vi } from "vitest";
import { createObsSafeInterval } from "@/lib/obs-safe-interval";

describe("createObsSafeInterval", () => {
  it("falls back to nested setTimeout when Worker is unavailable", () => {
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

  it("skips blob Worker on insecure HTTP context", () => {
    const originalWorker = globalThis.Worker;
    const workerCtor = vi.fn();
    // @ts-expect-error test stub
    globalThis.Worker = workerCtor;
    const g = globalThis as typeof globalThis & { window?: Window; isSecureContext?: boolean };
    const prevWindow = g.window;
    g.window = {
      get isSecureContext() {
        return false;
      },
    } as Window;

    vi.useFakeTimers();
    const fn = vi.fn();
    const stop = createObsSafeInterval(fn, 1000);
    expect(workerCtor).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
    vi.useRealTimers();

    g.window = prevWindow;
    globalThis.Worker = originalWorker;
  });

  it("falls back when Worker never posts a tick", () => {
    const originalWorker = globalThis.Worker;
    class SilentWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      postMessage(_data: unknown) {
        /* never posts */
      }
      terminate() {}
    }
    // @ts-expect-error test stub
    globalThis.Worker = SilentWorker;
    const g = globalThis as typeof globalThis & { window?: Window };
    const prevWindow = g.window;
    g.window = {
      get isSecureContext() {
        return true;
      },
    } as Window;

    vi.useFakeTimers();
    const fn = vi.fn();
    const stop = createObsSafeInterval(fn, 1000);
    /** watchdog(~2.2s) + nested timeout 1s → 첫 tick ≈ 3.2s */
    vi.advanceTimersByTime(3300);
    expect(fn).toHaveBeenCalled();
    const afterWatchdog = fn.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(fn.mock.calls.length).toBeGreaterThan(afterWatchdog);
    stop();
    vi.useRealTimers();

    g.window = prevWindow;
    globalThis.Worker = originalWorker;
  });
});
