import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mysqlKvGetJson = vi.fn();
vi.mock("./mysql-kv", () => ({
  mysqlKvGetJson: (...args: unknown[]) => mysqlKvGetJson(...args),
  mysqlKvSetJson: vi.fn(),
  mysqlKvSetNxEx: vi.fn(),
  mysqlKvDel: vi.fn(),
  getLastMysqlKvError: vi.fn(() => null),
}));

import { upstashGetJson } from "./upstash";

describe("upstashGetJson Redis miss", () => {
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const prevFallback = process.env.MYSQL_KV_FALLBACK_ON_REDIS_MISS;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: null }),
      }))
    );
    mysqlKvGetJson.mockReset();
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    delete process.env.MYSQL_KV_FALLBACK_ON_REDIS_MISS;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
    if (prevFallback === undefined) delete process.env.MYSQL_KV_FALLBACK_ON_REDIS_MISS;
    else process.env.MYSQL_KV_FALLBACK_ON_REDIS_MISS = prevFallback;
  });

  it("does not hit MySQL when Redis returns key miss (default)", async () => {
    const out = await upstashGetJson("missing-key");
    expect(out).toBeNull();
    expect(mysqlKvGetJson).not.toHaveBeenCalled();
  });

  it("hits MySQL on Redis miss when MYSQL_KV_FALLBACK_ON_REDIS_MISS=1", async () => {
    process.env.MYSQL_KV_FALLBACK_ON_REDIS_MISS = "1";
    process.env.DATABASE_URL = "mysql://u:p@127.0.0.1:3306/youtube";
    mysqlKvGetJson.mockResolvedValue({ ok: true });
    const out = await upstashGetJson("legacy-key");
    expect(mysqlKvGetJson).toHaveBeenCalledWith("legacy-key");
    expect(out).toEqual({ ok: true });
  });

  it("falls back to MySQL when Redis HTTP fails", async () => {
    process.env.DATABASE_URL = "mysql://u:p@127.0.0.1:3306/youtube";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    );
    mysqlKvGetJson.mockResolvedValue("from-mysql");
    const out = await upstashGetJson("k");
    expect(mysqlKvGetJson).toHaveBeenCalledWith("k");
    expect(out).toBe("from-mysql");
  });
});
