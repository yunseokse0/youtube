import { describe, expect, it } from "vitest";
import {
  dailyLogFromMonolith,
  dailyLogMonolithKvKey,
  dailyLogShardKvKey,
  isDailyLogShardKvKey,
  mergeDailyLogShardMaps,
  parseDailyLogShardDateFromKey,
  recentDailyLogDateKeys,
} from "@/lib/daily-log-shard";

describe("daily-log shard keys", () => {
  it("builds monolith and shard kv keys", () => {
    expect(dailyLogMonolithKvKey("din")).toBe("excel-broadcast-daily-log-v1:din");
    expect(dailyLogShardKvKey("din", "2026-09-02")).toBe(
      "excel-broadcast-daily-log-v1:din:2026-09-02"
    );
  });

  it("detects shard keys by date suffix", () => {
    const k = dailyLogShardKvKey("din", "2026-09-02");
    expect(isDailyLogShardKvKey(k, "din")).toBe(true);
    expect(parseDailyLogShardDateFromKey(k, "din")).toBe("2026-09-02");
    expect(isDailyLogShardKvKey("excel-broadcast-daily-log-v1:din:BAK", "din")).toBe(false);
  });

  it("recentDailyLogDateKeys includes today first", () => {
    const from = new Date("2026-09-02T12:00:00.000Z");
    const keys = recentDailyLogDateKeys(3, from);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("mergeDailyLogShardMaps merges date buckets", () => {
    const merged = mergeDailyLogShardMaps(
      { "2026-09-01": [{ at: "1", total: 1, members: [], donors: [] }] },
      { "2026-09-02": [{ at: "2", total: 2, members: [], donors: [] }] }
    );
    expect(Object.keys(merged)).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("dailyLogFromMonolith ignores migration stub", () => {
    expect(dailyLogFromMonolith({ __migrated: true })).toBeNull();
    const log = dailyLogFromMonolith({
      "2026-09-01": [{ at: "1", total: 1, members: [], donors: [] }],
    });
    expect(log?.["2026-09-01"]).toHaveLength(1);
  });
});
