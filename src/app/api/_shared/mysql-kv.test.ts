import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getMysqlDatabaseUrl,
  isMysqlKvConfigured,
  mysqlKvClosePool,
  mysqlKvConnModeFromDatabaseUrl,
} from "./mysql-kv";
import { isPersistentKvConfigured, isRedisConfigured } from "./upstash";

describe("mysql-kv / persistent kv flags", () => {
  const prevDb = process.env.DATABASE_URL;
  const prevRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  afterEach(async () => {
    await mysqlKvClosePool();
    if (prevDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDb;
    delete process.env.MYSQL_USE_SOCKET;
    if (prevRedisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = prevRedisUrl;
    if (prevRedisToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = prevRedisToken;
  });

  it("detects mysql DATABASE_URL", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.DATABASE_URL = "mysql://youtube_app:pw@127.0.0.1:3306/youtube";
    expect(getMysqlDatabaseUrl()).toContain("mysql://");
    expect(isMysqlKvConfigured()).toBe(true);
    expect(isRedisConfigured()).toBe(false);
    expect(isPersistentKvConfigured()).toBe(true);
  });

  it("ignores non-mysql DATABASE_URL", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.DATABASE_URL = "postgres://x";
    expect(isMysqlKvConfigured()).toBe(false);
    expect(isPersistentKvConfigured()).toBe(false);
  });

  it("prefers socket when MYSQL_USE_SOCKET=1 (EC2 private IP host)", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.MYSQL_USE_SOCKET = "1";
    process.env.DATABASE_URL = "mysql://youtube_app:pw@172.31.40.45:3306/youtube";
    expect(mysqlKvConnModeFromDatabaseUrl()).toBe("socket");
  });
});
