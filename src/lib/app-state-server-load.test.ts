import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const upstashGetAppStateJson = vi.fn();
vi.mock("@/app/api/_shared/upstash-app-state", () => ({
  upstashGetAppStateJson: (...args: unknown[]) => upstashGetAppStateJson(...args),
}));

const { isPersistentKvConfigured, getPersistentKvLastError, isKillSwitchForceMysqlOnly, isRedisConfigured, upstashPipelineCall } = vi.hoisted(() => ({
  isPersistentKvConfigured: vi.fn(() => true),
  getPersistentKvLastError: vi.fn(async () => null),
  isKillSwitchForceMysqlOnly: vi.fn(() => false),
  isRedisConfigured: vi.fn(() => false),
  upstashPipelineCall: vi.fn(async () => ({ results: [] })),
}));
vi.mock("@/app/api/_shared/upstash", () => ({
  isPersistentKvConfigured: () => isPersistentKvConfigured(),
  getPersistentKvLastError: () => getPersistentKvLastError(),
  isKillSwitchForceMysqlOnly: () => isKillSwitchForceMysqlOnly(),
  isRedisConfigured: () => isRedisConfigured(),
  upstashPipelineCall: function(...args: any[]) { return (upstashPipelineCall as unknown as Function).call(this, ...args); },
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
}));

const getServerMemoryAppState = vi.fn<(userId: string) => unknown>(() => null);
const setServerMemoryAppState = vi.fn<(userId: string, state: unknown) => void>();
vi.mock("@/lib/server-memory-app-state", () => ({
  getServerMemoryAppState: (userId: string) => getServerMemoryAppState(userId),
  setServerMemoryAppState: (userId: string, state: unknown) => setServerMemoryAppState(userId, state),
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
