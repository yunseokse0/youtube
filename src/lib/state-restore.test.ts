import { describe, expect, it } from "vitest";
import {
  buildAppStateFromRestoreJson,
  isFullBroadcastStateBackup,
  pickDailyLogEntryForRestore,
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

  it("prefers today daily log entry", () => {
    const log = {
      "2026-06-03": [{ at: "2026-06-03T08:00:00.000Z", total: 1, members: [], donors: [{ id: "d_old", name: "old", amount: 1, memberId: "m1", at: 1 }] }],
      "2026-06-04": [{ at: "2026-06-04T09:00:00.000Z", total: 2, members: [], donors: [{ id: "d_new", name: "new", amount: 2, memberId: "m1", at: 2 }] }],
    };
    const hit = pickDailyLogEntryForRestore(log, "2026-06-04");
    expect(hit?.donors?.[0]?.id).toBe("d_new");
  });
});
