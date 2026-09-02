import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const upstashGetAppStateJson = vi.fn();
vi.mock("@/app/api/_shared/upstash-app-state", () => ({
  upstashGetAppStateJson: (...args: unknown[]) => upstashGetAppStateJson(...args),
}));

const isPersistentKvConfigured = vi.fn(() => true);
const getPersistentKvLastError = vi.fn(async () => null);
vi.mock("@/app/api/_shared/upstash", () => ({
  isPersistentKvConfigured: () => isPersistentKvConfigured(),
  getPersistentKvLastError: () => getPersistentKvLastError(),
}));

const getServerMemoryAppState = vi.fn(() => null);
const setServerMemoryAppState = vi.fn();
vi.mock("@/lib/server-memory-app-state", () => ({
  getServerMemoryAppState: (...args: unknown[]) => getServerMemoryAppState(...args),
  setServerMemoryAppState: (...args: unknown[]) => setServerMemoryAppState(...args),
}));

import { loadAppStateForUserId } from "./app-state-server-load";

describe("loadAppStateForUserId coalescing", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("merges concurrent loads for the same userId into one KV read", async () => {
    let resolveKv: (v: unknown) => void = () => {};
    upstashGetAppStateJson.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveKv = resolve;
        })
    );

    const p1 = loadAppStateForUserId("user-a");
    const p2 = loadAppStateForUserId("user-a");
    expect(upstashGetAppStateJson).toHaveBeenCalledTimes(1);

    resolveKv({ updatedAt: 100, members: [], donors: [] });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1?.updatedAt).toBe(100);
    expect(r2?.updatedAt).toBe(100);
  });
});
