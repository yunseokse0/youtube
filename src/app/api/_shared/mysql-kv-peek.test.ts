import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { execute, createConnection } = vi.hoisted(() => {
  const execute = vi.fn();
  const createConnection = vi.fn(async () => ({
    execute,
    ping: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  }));
  return { execute, createConnection };
});

vi.mock("mysql2/promise", () => ({
  default: { createConnection },
}));

import { mysqlKvPeekRevision, mysqlKvSetJson, mysqlKvClosePool } from "./mysql-kv";

describe("mysqlKvPeekRevision", () => {
  afterEach(async () => {
    await mysqlKvClosePool();
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
  });

  it("returns updated_at without reading v column payload", async () => {
    process.env.DATABASE_URL = "mysql://u:p@127.0.0.1:3306/youtube";
    execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ updated_at: 42_000 }]]);
    const rev = await mysqlKvPeekRevision("state-key");
    expect(rev).toBe(42_000);
    const sql = String(execute.mock.calls.at(-1)?.[0] || "");
    expect(sql).toContain("updated_at");
    expect(sql).not.toContain("SELECT `v`");
  });

  it("stores app state revision in updated_at on setJson", async () => {
    process.env.DATABASE_URL = "mysql://u:p@127.0.0.1:3306/youtube";
    execute.mockResolvedValue([[]]);
    await mysqlKvSetJson("k", { updatedAt: 99_000, members: [] });
    const params = execute.mock.calls.at(-1)?.[1] as unknown[];
    expect(params?.[3]).toBe(99_000);
  });
});
