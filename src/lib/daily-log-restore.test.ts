import { describe, expect, it } from "vitest";
import { maybeAppendDailyLogFromState, DAILY_LOG_AUTO_APPEND_MIN_MS } from "@/lib/daily-log-server-append";
import { broadcastDateKey } from "@/lib/state";
import {
  pickDailyLogEntryForAutoRestore,
  pickDailyLogEntryForRestore,
  DAILY_LOG_AUTO_RESTORE_MAX_AGE_MS,
} from "@/lib/state-restore";
import { defaultState } from "@/lib/state";

describe("broadcastDateKey", () => {
  it("uses KST calendar day (not UTC midnight drift)", () => {
    // 2026-08-28 02:00 KST = 2026-08-27 17:00 UTC — still Aug 28 in KST
    const kstEarly = new Date("2026-08-27T17:00:00.000Z");
    expect(broadcastDateKey(kstEarly)).toBe("2026-08-28");
  });
});

describe("pickDailyLogEntryForAutoRestore", () => {
  const oldEntry = {
    at: new Date(Date.now() - DAILY_LOG_AUTO_RESTORE_MAX_AGE_MS - 60_000).toISOString(),
    total: 999,
    members: [],
    donors: [{ id: "d_old", name: "old", amount: 999, memberId: "m1", at: 1 }],
  };
  const recentEntry = {
    at: new Date(Date.now() - 60_000).toISOString(),
    total: 100,
    members: [],
    donors: [{ id: "d_new", name: "new", amount: 100, memberId: "m1", at: 2 }],
  };

  it("prefers today bucket over older dates", () => {
    const today = broadcastDateKey();
    const log = {
      "2026-06-01": [oldEntry],
      [today]: [recentEntry],
    };
    const hit = pickDailyLogEntryForAutoRestore(log, today);
    expect(hit?.donors?.[0]?.id).toBe("d_new");
  });

  it("does not fall back to stale snapshots beyond max age", () => {
    const log = {
      "2026-06-01": [oldEntry],
    };
    const hit = pickDailyLogEntryForAutoRestore(log, "2099-01-01");
    expect(hit).toBeNull();
  });

  it("pickDailyLogEntryForRestore still allows global latest for manual paths", () => {
    const log = {
      "2026-06-01": [oldEntry],
    };
    const hit = pickDailyLogEntryForRestore(log);
    expect(hit?.donors?.[0]?.id).toBe("d_old");
  });
});

describe("maybeAppendDailyLogFromState", () => {
  it("skips empty donation state", async () => {
    const ok = await maybeAppendDailyLogFromState("u1", defaultState());
    expect(ok).toBe(false);
  });

  it("exports throttle constant", () => {
    expect(DAILY_LOG_AUTO_APPEND_MIN_MS).toBeGreaterThanOrEqual(60_000);
  });
});
