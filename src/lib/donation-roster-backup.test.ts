import { describe, expect, it } from "vitest";
import {
  applyDonationRosterBackupToState,
  buildDonationRosterBackupPayload,
  shouldRestoreDonationRosterFromBackup,
  type DonationRosterBackupPayload,
} from "@/lib/donation-roster-backup";
import { defaultState } from "@/lib/state";
import type { AppState } from "@/types";

function richState(): AppState {
  return {
    ...defaultState(),
    members: [{ id: "m1", name: "피자", account: 60000, toon: 0, contribution: 60000 }],
    donors: [
      {
        id: "d1",
        name: "익명",
        amount: 60000,
        memberId: "m1",
        at: Date.now(),
        target: "account",
      },
    ],
    updatedAt: Date.now(),
  };
}

describe("donation-roster-backup", () => {
  it("builds payload only when donations exist", () => {
    expect(buildDonationRosterBackupPayload(defaultState())).toBeNull();
    const payload = buildDonationRosterBackupPayload(richState());
    expect(payload?.donorsCount).toBe(1);
    expect(payload?.total).toBe(60000);
  });

  it("restores when current is empty and backup has donors", () => {
    const backup = buildDonationRosterBackupPayload(richState())!;
    expect(shouldRestoreDonationRosterFromBackup(defaultState(), backup)).toBe(true);
  });

  it("does not restore after newer settlement reset cleared donations", () => {
    const backup = buildDonationRosterBackupPayload(richState())!;
    const cleared: AppState = {
      ...defaultState(),
      settlementResetAt: (backup.settlementResetAt || 0) + 10_000,
      donors: [],
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
    };
    expect(shouldRestoreDonationRosterFromBackup(cleared, backup)).toBe(false);
  });

  it("applies backup members and donors to empty state", () => {
    const backup = buildDonationRosterBackupPayload(richState()) as DonationRosterBackupPayload;
    const next = applyDonationRosterBackupToState(defaultState(), backup);
    expect(next.donors).toHaveLength(1);
    expect(next.members[0]?.account).toBe(60000);
  });
});
