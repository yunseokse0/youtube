import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const upstashGetAppStateJson = vi.fn();
vi.mock("@/app/api/_shared/upstash-app-state", () => ({
  upstashGetAppStateJson: (...args: unknown[]) => upstashGetAppStateJson(...args),
}));

const { isPersistentKvConfigured, isMysqlOnlyPersistentKvConfigured, getPersistentKvLastError, isKillSwitchForceMysqlOnly, isRedisConfigured, upstashPipelineCall } = vi.hoisted(() => ({
  isPersistentKvConfigured: vi.fn(() => true),
  isMysqlOnlyPersistentKvConfigured: vi.fn(() => false),
  getPersistentKvLastError: vi.fn(async () => null),
  isKillSwitchForceMysqlOnly: vi.fn(() => false),
  isRedisConfigured: vi.fn(() => false),
  upstashPipelineCall: vi.fn(async () => ({ results: [] })),
}));
vi.mock("@/app/api/_shared/upstash", () => ({
  isPersistentKvConfigured: () => isPersistentKvConfigured(),
  isMysqlOnlyPersistentKvConfigured: () => isMysqlOnlyPersistentKvConfigured(),
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

import { invalidateAppStateKvCache, loadAppStateForUserId } from "./app-state-server-load";

describe("loadAppStateForUserId coalescing", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isMysqlOnlyPersistentKvConfigured.mockImplementation(() => false);
    getServerMemoryAppState.mockImplementation(() => null);
  });

  it("MySQL-only: warm memory is returned without reading MySQL (no 14s timeout while writes are busy)", async () => {
    isMysqlOnlyPersistentKvConfigured.mockImplementation(() => true);
    const mem = { updatedAt: 200, members: [{ id: "m1", name: "소야" }], donors: [{ id: "d1" }] };
    getServerMemoryAppState.mockImplementation(() => mem);
    upstashGetAppStateJson.mockImplementation(() => new Promise(() => {}));
    invalidateAppStateKvCache("user-warm");

    const got = await loadAppStateForUserId("user-warm");
    expect(got).toBe(mem);
    expect(upstashGetAppStateJson).not.toHaveBeenCalled();
  });

  it("MySQL-only: cold start (no memory) still reads MySQL", async () => {
    isMysqlOnlyPersistentKvConfigured.mockImplementation(() => true);
    upstashGetAppStateJson.mockImplementation(async () => ({
      updatedAt: 300,
      members: [{ id: "m1", name: "소야" }],
      donors: [],
    }));
    invalidateAppStateKvCache("user-cold");

    const got = await loadAppStateForUserId("user-cold");
    expect(upstashGetAppStateJson).toHaveBeenCalledTimes(1);
    expect(got?.updatedAt).toBe(300);
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
