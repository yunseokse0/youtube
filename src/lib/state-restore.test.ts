import { describe, expect, it } from "vitest";
import {
  buildAppStateFromDailyLogRestore,
  buildAppStateFromRestoreJson,
  buildSettlementCreationSnapshot,
  enrichSettlementSnapshotFromDailyLog,
  enrichAppStateFromDailyLogWhenDonorsMissing,
  isFullBroadcastStateBackup,
  isOrphanedDonationState,
  pickDailyLogEntryForRestore,
  pickDailyLogEntryForManualRestore,
} from "@/lib/state-restore";
import { defaultState } from "@/lib/state";

describe("state-restore", () => {
  it("detects full broadcast backup", () => {
    expect(isFullBroadcastStateBackup({ members: [{ id: "m1" }] })).toBe(true);
    expect(isFullBroadcastStateBackup({ sigInventory: [{ id: "s1" }] })).toBe(false);
  });

  it("fullReplace resets to backup members and presets", () => {
    const next = buildAppStateFromRestoreJson(
      {
        members: [{ id: "m1", name: "패자", account: 100, toon: 0, contribution: 100 }],
        overlayPresets: [{ id: "ov1", name: "테스트" }],
        sigInventory: [{ id: "sig_a", name: "A", price: 1, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true }],
      },
      { fullReplace: true }
    );
    expect(next.members[0]?.name).toBe("패자");
    expect(next.overlayPresets).toHaveLength(1);
    expect(next.sigInventory.some((x) => x.id === "sig_a")).toBe(true);
    expect(next.members).not.toEqual(defaultState().members);
  });

  it("detects orphaned donation state", () => {
    expect(
      isOrphanedDonationState({
        donors: [],
        members: [{ id: "m1", name: "A", account: 1000, toon: 0, contribution: 1000 }],
      })
    ).toBe(true);
    expect(
      isOrphanedDonationState({
        donors: [{ id: "d1", name: "B", amount: 1000, memberId: "m1", at: 1 }],
        members: [{ id: "m1", name: "A", account: 1000, toon: 0, contribution: 1000 }],
      })
    ).toBe(false);
  });

  it("builds restore state from daily log entry", () => {
    const base = defaultState();
    const restored = buildAppStateFromDailyLogRestore(base, {
      at: "2026-06-04T09:00:00.000Z",
      total: 5000,
      members: [{ id: "m1", name: "자기", account: 5000, toon: 0, contribution: 5000 }],
      donors: [{ id: "d1", name: "후원", amount: 5000, memberId: "m1", at: 2 }],
    });
    expect(restored?.donors).toHaveLength(1);
    expect(restored?.members[0]?.account).toBe(5000);
  });

  it("does not restore daily log taken at/before intentional settlement reset", () => {
    const resetAt = Date.parse("2026-08-27T12:00:00.000Z");
    const cleared = {
      ...defaultState(),
      settlementResetAt: resetAt,
      donors: [],
      members: [{ id: "m1", name: "헛치", account: 0, toon: 0, contribution: 0 }],
      updatedAt: resetAt,
    };
    const restored = buildAppStateFromDailyLogRestore(cleared, {
      at: "2026-08-27T11:59:59.000Z",
      total: 50000,
      members: [{ id: "m1", name: "헛치", account: 50000, toon: 0, contribution: 50000 }],
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 50000,
          memberId: "m1",
          at: resetAt - 10_000,
          target: "account",
        },
      ],
    });
    expect(restored).toBeNull();
  });

  it("manual restore prefers richest snapshot over latest 1-donor wipe", () => {
    const log = {
      "2026-08-27": [
        {
          at: "2026-08-27T12:44:17.651Z",
          total: 945007,
          members: [],
          donors: Array.from({ length: 203 }, (_, i) => ({
            id: `d_${i}`,
            name: `donor_${i}`,
            amount: 1,
            memberId: "m1",
            at: i + 1,
          })),
        },
        {
          at: "2026-08-27T12:50:14.264Z",
          total: 1,
          members: [],
          donors: [{ id: "d_test", name: "테스트", amount: 1, memberId: "m1", at: 99 }],
        },
      ],
    };
    const hit = pickDailyLogEntryForManualRestore(log, 1);
    expect(hit?.donors).toHaveLength(203);
  });

  it("prefers today daily log entry", () => {
    const log = {
      "2026-06-03": [{ at: "2026-06-03T08:00:00.000Z", total: 1, members: [], donors: [{ id: "d_old", name: "old", amount: 1, memberId: "m1", at: 1 }] }],
      "2026-06-04": [{ at: "2026-06-04T09:00:00.000Z", total: 2, members: [], donors: [{ id: "d_new", name: "new", amount: 2, memberId: "m1", at: 2 }] }],
    };
    const hit = pickDailyLogEntryForRestore(log, "2026-06-04");
    expect(hit?.donors?.[0]?.id).toBe("d_new");
  });

  it("rebump pre-reset donor at on settlement snapshot", () => {
    const resetAt = 10_000;
    const live = {
      ...defaultState(),
      settlementResetAt: resetAt,
      members: [{ id: "m1", name: "A", account: 1000, toon: 0, contribution: 1000 }],
      donors: [{ id: "d1", name: "B", amount: 1000, memberId: "m1", at: 5000, target: "account" as const }],
    };
    const snap = buildSettlementCreationSnapshot(live);
    expect(Number(snap.donors[0]?.at)).toBeGreaterThanOrEqual(resetAt);
  });

  it("enriches orphan snapshot from daily log", () => {
    const resetAt = 10_000;
    const orphan = {
      ...defaultState(),
      settlementResetAt: resetAt,
      members: [{ id: "m1", name: "A", account: 1000, toon: 0, contribution: 1000 }],
      donors: [],
    };
    const log = {
      "2026-06-04": [
        {
          at: "2026-06-04T09:00:00.000Z",
          total: 1000,
          members: orphan.members,
          donors: [{ id: "d1", name: "B", amount: 1000, memberId: "m1", at: 12_000, target: "account" as const }],
        },
      ],
    };
    const enriched = enrichSettlementSnapshotFromDailyLog(orphan, log, "2026-06-04");
    expect(enriched.donors).toHaveLength(1);
  });

  it("enrichAppStateFromDailyLogWhenDonorsMissing restores when donors and totals are zero", () => {
    const base = defaultState();
    const log = {
      "2026-08-20": [
        {
          at: "2026-08-20T12:00:00.000Z",
          total: 50000,
          donors: [
            {
              id: "d1",
              name: "후원",
              amount: 50000,
              memberId: "m1",
              at: Date.now(),
              target: "account" as const,
            },
          ],
          members: [{ id: "m1", name: "멤버", account: 0, toon: 0, contribution: 0 }],
        },
      ],
    };
    const next = enrichAppStateFromDailyLogWhenDonorsMissing(
      {
        ...base,
        donors: [],
        members: base.members.map((m) => ({ ...m, account: 0, toon: 0, contribution: 0 })),
      },
      log
    );
    expect(next.donors).toHaveLength(1);
  });
});
