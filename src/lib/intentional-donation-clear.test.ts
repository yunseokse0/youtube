import { describe, expect, it } from "vitest";
import {
  clearIntentionalDonationClearIfHasDonations,
  coalesceIntentionalDonationClearAt,
  isIntentionalDonationClearActive,
  markIntentionalDonationEmptySession,
  shouldSuppressAutoRosterRestore,
  withIntentionalDonationClear,
} from "@/lib/intentional-donation-clear";
import { applySettlementResetToState } from "@/lib/settlement-reset-apply";
import { defaultState, shouldBlockAccidentalEmptyOverwrite } from "@/lib/state";
import { shouldRestoreDonationRosterFromBackup } from "@/lib/donation-roster-backup-core";
import type { AppState } from "@/types";

describe("intentionalDonationClearAt", () => {
  it("marks keep/init reset as intentional clear, not accidental", () => {
    const rich: AppState = {
      ...defaultState(),
      settlementResetAt: 100,
      members: [{ id: "m1", name: "헛치", account: 50000, toon: 0, contribution: 50000 }],
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 50000,
          memberId: "m1",
          at: 50,
          target: "account",
        },
      ],
    };
    const keep = applySettlementResetToState(rich, { mode: "keep", resetAt: 9000 });
    expect(keep.intentionalDonationClearAt).toBe(9000);
    expect(isIntentionalDonationClearActive(keep)).toBe(true);
    expect(shouldSuppressAutoRosterRestore(keep)).toBe(true);
    expect(shouldBlockAccidentalEmptyOverwrite(rich, keep)).toBe(false);

    const init = applySettlementResetToState(rich, {
      mode: "init",
      memberSlotCount: 3,
      resetAt: 9001,
    });
    expect(init.intentionalDonationClearAt).toBe(9001);
    expect(isIntentionalDonationClearActive(init)).toBe(true);
    expect(shouldBlockAccidentalEmptyOverwrite(rich, init)).toBe(false);
  });

  it("does not suppress restore for accidental placeholder wipe without marker", () => {
    const wiped = {
      ...defaultState(),
      settlementResetAt: 100,
      donors: [],
    };
    expect(isIntentionalDonationClearActive(wiped)).toBe(false);
    expect(shouldSuppressAutoRosterRestore(wiped)).toBe(false);
    const backup = {
      members: [{ id: "m1", name: "헛치", account: 50000, toon: 0, contribution: 50000 }],
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 50000,
          memberId: "m1",
          at: 50,
          target: "account" as const,
        },
      ],
      settlementResetAt: 100,
      savedAt: 200,
      total: 50000,
      donorsCount: 1,
    };
    expect(shouldRestoreDonationRosterFromBackup(wiped, backup)).toBe(true);
  });

  it("suppresses backup restore while intentional clear is active", () => {
    const cleared = withIntentionalDonationClear(
      {
        ...defaultState(),
        donors: [],
        members: [{ id: "m1", name: "멤버1", account: 0, toon: 0, contribution: 0 }],
      },
      9000
    );
    const backup = {
      members: [{ id: "m1", name: "헛치", account: 50000, toon: 0, contribution: 50000 }],
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 50000,
          memberId: "m1",
          at: 50,
          target: "account" as const,
        },
      ],
      settlementResetAt: 100,
      savedAt: 200,
      total: 50000,
      donorsCount: 1,
    };
    expect(shouldRestoreDonationRosterFromBackup(cleared, backup)).toBe(false);
  });

  it("clears marker once donations exist", () => {
    const cleared = withIntentionalDonationClear({ ...defaultState(), donors: [] }, 9000);
    const withDonation = clearIntentionalDonationClearIfHasDonations({
      ...cleared,
      donors: [
        {
          id: "d1",
          name: "새후원",
          amount: 1000,
          memberId: "m1",
          at: 9500,
          target: "account",
        },
      ],
      members: [{ id: "m1", name: "멤버1", account: 1000, toon: 0, contribution: 1000 }],
    });
    expect(withDonation.intentionalDonationClearAt).toBeUndefined();
  });

  it("coalesce only raises clear marker with settlementReset flag", () => {
    expect(
      coalesceIntentionalDonationClearAt({
        baseClearAt: 100,
        patchClearAt: 9999,
        settlementReset: false,
      })
    ).toBe(100);
    expect(
      coalesceIntentionalDonationClearAt({
        baseClearAt: 100,
        settlementReset: true,
        resetStamp: 5000,
      })
    ).toBe(5000);
    expect(
      coalesceIntentionalDonationClearAt({
        baseClearAt: 100,
        hasDonations: true,
      })
    ).toBeUndefined();
  });

  it("markIntentionalDonationEmptySession suppresses auto restore without bumping settlementResetAt", () => {
    const cleared = markIntentionalDonationEmptySession({
      ...defaultState(),
      settlementResetAt: 100,
      members: [{ id: "m1", name: "자키", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    });
    expect(cleared.intentionalDonationClearAt).toBeGreaterThan(0);
    expect(cleared.settlementResetAt).toBe(100);
    expect(shouldSuppressAutoRosterRestore(cleared)).toBe(true);
  });
});
