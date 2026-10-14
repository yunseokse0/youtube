import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({
  failNext: 0,
  writes: [] as Array<{ key: string; value: unknown }>,
}));

vi.mock("./upstash", () => ({
  isPersistentKvConfigured: () => true,
  upstashGetJson: vi.fn(async () => null),
  upstashSetJsonWithPipeline: vi.fn(async (key: string, value: unknown) => {
    if (kv.failNext > 0) {
      kv.failNext -= 1;
      return false;
    }
    kv.writes.push({ key, value });
    return true;
  }),
}));

import { getPendingAppStateWriteCount, upstashSetAppStateJson } from "./upstash-app-state";

const KEY = "excel-broadcast-state-v1:din";

async function settle(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("upstashSetAppStateJson — 정산표 저장은 성공할 때까지 다시 쓴다", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    kv.failNext = 0;
    kv.writes.length = 0;
  });
  afterEach(async () => {
    kv.failNext = 0;
    await settle(60_000);
    vi.useRealTimers();
  });

  it("MySQL 이 연달아 실패해도 결국 마지막 정산표가 저장된다", async () => {
    kv.failNext = 4;
    const state = { donors: [{ id: "bank:sms:a" }], updatedAt: 1 };
    expect(await upstashSetAppStateJson(KEY, state)).toBe(false);
    expect(getPendingAppStateWriteCount()).toBe(1);

    await settle(1_000 + 2_000 + 4_000 + 8_000);
    expect(kv.writes).toEqual([{ key: KEY, value: state }]);
    expect(getPendingAppStateWriteCount()).toBe(0);
  });

  it("실패한 옛 값은 그 뒤 새 값이 저장되면 다시 쓰지 않는다", async () => {
    kv.failNext = 1;
    const older = { donors: [{ id: "a" }], updatedAt: 1 };
    const newer = { donors: [{ id: "a" }, { id: "b" }], updatedAt: 2 };
    expect(await upstashSetAppStateJson(KEY, older)).toBe(false);
    expect(await upstashSetAppStateJson(KEY, newer)).toBe(true);

    await settle(30_000);
    expect(kv.writes.map((w) => w.value)).toEqual([newer]);
    expect(getPendingAppStateWriteCount()).toBe(0);
  });

  it("새 값도 실패하면 새 값만 다시 쓴다", async () => {
    kv.failNext = 2;
    const older = { donors: [{ id: "a" }], updatedAt: 1 };
    const newer = { donors: [{ id: "a" }, { id: "b" }], updatedAt: 2 };
    await upstashSetAppStateJson(KEY, older);
    await upstashSetAppStateJson(KEY, newer);

    await settle(30_000);
    expect(kv.writes.map((w) => w.value)).toEqual([newer]);
  });

  it("정산표가 아닌 키는 다시 쓰지 않는다", async () => {
    kv.failNext = 1;
    expect(await upstashSetAppStateJson("excel-broadcast-daily-log-v1:din", { x: 1 })).toBe(false);
    await settle(30_000);
    expect(kv.writes).toEqual([]);
    expect(getPendingAppStateWriteCount()).toBe(0);
  });
});
