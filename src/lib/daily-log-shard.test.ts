import { describe, expect, it } from "vitest";
import {
  dailyLogFromMonolith,
  dailyLogMonolithKvKey,
  dailyLogShardKvKey,
  compactDailyLogDayEntries,
  isDailyLogShardKvKey,
  mergeDailyLogShardMaps,
  parseDailyLogShardDateFromKey,
  recentDailyLogDateKeys,
  slimDailyLogEntry,
  trimDailyLogEntries,
  trimDailyLogMap,
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

  it("trimDailyLogEntries keeps latest N by at", () => {
    const trimmed = trimDailyLogEntries(
      [
        { at: "2026-09-01T01:00:00.000Z", total: 1, members: [], donors: [] },
        { at: "2026-09-01T03:00:00.000Z", total: 3, members: [], donors: [] },
        { at: "2026-09-01T02:00:00.000Z", total: 2, members: [], donors: [] },
      ],
      2
    );
    expect(trimmed.map((e) => e.total)).toEqual([2, 3]);
  });

  it("trimDailyLogMap applies per day", () => {
    const out = trimDailyLogMap(
      {
        "2026-09-01": [
          { at: "a", total: 1, members: [], donors: [] },
          { at: "b", total: 2, members: [], donors: [] },
          { at: "c", total: 3, members: [], donors: [] },
        ],
      },
      1
    );
    expect(out["2026-09-01"]).toHaveLength(1);
    expect(out["2026-09-01"]![0]!.total).toBe(3);
  });

  it("slimDailyLogEntry drops heavy optional fields", () => {
    const slim = slimDailyLogEntry({
      at: "t",
      total: 1000,
      members: [
        {
          id: "m1",
          name: "자키",
          account: 1,
          toon: 2,
          goal: 999,
          restroom: 1,
        },
      ],
      donors: [
        {
          id: "d1",
          name: "A",
          amount: 1000,
          memberId: "m1",
          at: 1,
          target: "toon",
          message: "hi",
          contributionPoints: 100,
          hsPushDir: "left",
        },
      ],
    });
    expect(slim.members[0]).toEqual({ id: "m1", name: "자키", account: 1, toon: 2 });
    expect(slim.donors[0]).toEqual({
      id: "d1",
      name: "A",
      amount: 1000,
      memberId: "m1",
      at: 1,
      target: "toon",
      message: "hi",
    });
    expect(slim.donorCount).toBe(1);
  });

  it("compactDailyLogDayEntries keeps full donors only on latest snapshots", () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      at: `2026-09-01T0${i}:00:00.000Z`,
      total: (i + 1) * 1000,
      members: [{ id: "m1", name: "자키", account: 0, toon: 0 }],
      donors: Array.from({ length: 3 }, (_, j) => ({
        id: `d${i}-${j}`,
        name: "A",
        amount: 1000,
        memberId: "m1",
        at: i,
        target: "toon" as const,
      })),
    }));
    const out = compactDailyLogDayEntries(entries, { maxEntries: 6, fullSnapshots: 2 });
    expect(out).toHaveLength(6);
    expect(out[0]!.summaryOnly).toBe(true);
    expect(out[0]!.donors).toHaveLength(0);
    expect(out[0]!.donorCount).toBe(3);
    expect(out[4]!.donors).toHaveLength(3);
    expect(out[5]!.donors).toHaveLength(3);
    expect(out[5]!.summaryOnly).toBeUndefined();
  });
});
