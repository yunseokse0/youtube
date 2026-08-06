import { describe, expect, it } from "vitest";
import {
  buildOverlaySyncSignature,
  buildSigSalesOverlaySyncSignature,
} from "@/lib/overlay-sync-signature";
import { defaultState } from "@/lib/state";
import { MANUAL_SIG_DRAFT_STATE_KEY } from "@/lib/manual-sig-workbench";

describe("buildOverlaySyncSignature", () => {
  it("changes when timer display style changes but members are the same", () => {
    const a = defaultState();
    const b = {
      ...a,
      timerDisplayStyles: {
        general: {
          ...a.timerDisplayStyles.general,
          bgColor: "transparent",
          borderColor: "transparent",
          bgOpacity: 0,
        },
      },
    };
    expect(buildOverlaySyncSignature(a)).not.toBe(buildOverlaySyncSignature(b));
  });

  it("changes when sig rolling hold time changes", () => {
    const a = defaultState();
    const b = {
      ...a,
      sigRolling: { ...a.sigRolling, staticHoldMs: 40000 },
    };
    expect(buildOverlaySyncSignature(a)).not.toBe(buildOverlaySyncSignature(b));
  });

  it("changes when member toon amount changes", () => {
    const a = defaultState();
    const members = (a.members || []).map((m, i) =>
      i === 0 ? { ...m, toon: 100_000 } : m
    );
    const b = { ...a, members };
    expect(buildOverlaySyncSignature(a)).not.toBe(buildOverlaySyncSignature(b));
  });
});

describe("isNewerIntentionalDonationShrink", () => {
  it("detects newer local delete that reduces donors", async () => {
    const { isNewerIntentionalDonationShrink } = await import("@/lib/overlay-sync-signature");
    const older = {
      ...defaultState(),
      updatedAt: 1000,
      donors: [
        { id: "d1", name: "a", amount: 10000, memberId: "m1", at: 1, target: "account" as const },
        { id: "d2", name: "b", amount: 20000, memberId: "m1", at: 2, target: "account" as const },
      ],
      members: [{ id: "m1", name: "홍쓰", account: 30000, toon: 0, contribution: 30000 }],
    };
    const newer = {
      ...older,
      updatedAt: 2000,
      donors: [older.donors[0]!],
      members: [{ id: "m1", name: "홍쓰", account: 10000, toon: 0, contribution: 10000 }],
    };
    expect(isNewerIntentionalDonationShrink(newer, older)).toBe(true);
    expect(isNewerIntentionalDonationShrink(older, newer)).toBe(false);
  });

  it("rejects older empty redis as intentional shrink", async () => {
    const { isNewerIntentionalDonationShrink, isRicherDonationSnapshot } = await import(
      "@/lib/overlay-sync-signature"
    );
    const lastGood = {
      ...defaultState(),
      updatedAt: 3000,
      donors: [
        { id: "d1", name: "a", amount: 10000, memberId: "m1", at: 1, target: "account" as const },
      ],
      members: [{ id: "m1", name: "홍쓰", account: 10000, toon: 0, contribution: 10000 }],
    };
    const emptyStale = {
      ...defaultState(),
      updatedAt: 1000,
      donors: [] as typeof lastGood.donors,
      members: [{ id: "m1", name: "홍쓰", account: 0, toon: 0, contribution: 0 }],
    };
    expect(isRicherDonationSnapshot(lastGood, emptyStale)).toBe(true);
    expect(isNewerIntentionalDonationShrink(emptyStale, lastGood)).toBe(false);
  });
});

describe("shouldRejectPoorerDonationRemote", () => {
  it("rejects empty remote when local has donors and reset is not newer", async () => {
    const { shouldRejectPoorerDonationRemote } = await import("@/lib/overlay-sync-signature");
    const local = {
      ...defaultState(),
      updatedAt: 1000,
      settlementResetAt: 500,
      donors: [
        { id: "d1", name: "a", amount: 10000, memberId: "m1", at: 1, target: "account" as const },
      ],
      members: [{ id: "m1", name: "홍쓰", account: 10000, toon: 0, contribution: 10000 }],
    };
    const emptyRemote = {
      ...defaultState(),
      updatedAt: 2000,
      settlementResetAt: 500,
      donors: [] as typeof local.donors,
      members: [{ id: "m1", name: "홍쓰", account: 0, toon: 0, contribution: 0 }],
    };
    expect(shouldRejectPoorerDonationRemote(local, emptyRemote)).toBe(true);
  });

  it("allows empty remote when settlementResetAt is newer", async () => {
    const { shouldRejectPoorerDonationRemote } = await import("@/lib/overlay-sync-signature");
    const local = {
      ...defaultState(),
      updatedAt: 1000,
      settlementResetAt: 500,
      donors: [
        { id: "d1", name: "a", amount: 10000, memberId: "m1", at: 1, target: "account" as const },
      ],
      members: [{ id: "m1", name: "홍쓰", account: 10000, toon: 0, contribution: 10000 }],
    };
    const resetRemote = {
      ...defaultState(),
      updatedAt: 2000,
      settlementResetAt: 900,
      donors: [] as typeof local.donors,
      members: [{ id: "m1", name: "홍쓰", account: 0, toon: 0, contribution: 0 }],
    };
    expect(shouldRejectPoorerDonationRemote(local, resetRemote)).toBe(false);
  });

  it("allows intentional single-donor delete shrink", async () => {
    const { shouldRejectPoorerDonationRemote } = await import("@/lib/overlay-sync-signature");
    const local = {
      ...defaultState(),
      updatedAt: 1000,
      settlementResetAt: 500,
      donors: [
        { id: "d1", name: "a", amount: 10000, memberId: "m1", at: 1, target: "account" as const },
        { id: "d2", name: "b", amount: 20000, memberId: "m1", at: 2, target: "account" as const },
      ],
      members: [{ id: "m1", name: "홍쓰", account: 30000, toon: 0, contribution: 30000 }],
    };
    const shrunk = {
      ...local,
      updatedAt: 2000,
      donors: [local.donors[0]!],
      members: [{ id: "m1", name: "홍쓰", account: 10000, toon: 0, contribution: 10000 }],
    };
    expect(shouldRejectPoorerDonationRemote(local, shrunk)).toBe(false);
  });

  it("allows remote with new donor ids even when local totals look richer", async () => {
    const { shouldRejectPoorerDonationRemote } = await import("@/lib/overlay-sync-signature");
    const local = {
      ...defaultState(),
      updatedAt: 1000,
      settlementResetAt: 500,
      donors: [
        { id: "ghost1", name: "old", amount: 100000, memberId: "m1", at: 1, target: "account" as const },
      ],
      members: [{ id: "m1", name: "홍쓰", account: 100000, toon: 0, contribution: 100000 }],
    };
    const remoteWithNew = {
      ...defaultState(),
      updatedAt: 2000,
      settlementResetAt: 500,
      donors: [
        { id: "fresh1", name: "new", amount: 10000, memberId: "m1", at: 2000, target: "account" as const },
      ],
      members: [{ id: "m1", name: "홍쓰", account: 10000, toon: 0, contribution: 10000 }],
    };
    /** poorer+신규 id 만으로는 허용하지 않음 — 호출측 union 후 적용 */
    expect(shouldRejectPoorerDonationRemote(local, remoteWithNew)).toBe(true);
  });

  it("rejects poorer toon-only remote that drops manual account donors", async () => {
    const { shouldRejectPoorerDonationRemote } = await import("@/lib/overlay-sync-signature");
    const local = {
      ...defaultState(),
      updatedAt: 1000,
      donorRankingsUpdatedAt: 1000,
      settlementResetAt: 500,
      donors: [
        {
          id: "d_bulk_1",
          name: "계좌",
          amount: 100000,
          memberId: "m1",
          at: 1,
          target: "account" as const,
        },
      ],
      members: [{ id: "m1", name: "홍쓰", account: 100000, toon: 0, contribution: 100000 }],
    };
    const remote = {
      ...defaultState(),
      updatedAt: 2000,
      donorRankingsUpdatedAt: 2500,
      settlementResetAt: 500,
      donors: [
        {
          id: "toonation:new",
          name: "투네",
          amount: 10000,
          memberId: "m1",
          at: 2000,
          target: "toon" as const,
        },
      ],
      members: [{ id: "m1", name: "홍쓰", account: 0, toon: 10000, contribution: 10000 }],
    };
    expect(shouldRejectPoorerDonationRemote(local, remote)).toBe(true);
  });

  it("allows remote when local excel totals are 0 but remote donors advanced", async () => {
    const { shouldRejectPoorerDonationRemote } = await import("@/lib/overlay-sync-signature");
    const local = {
      ...defaultState(),
      updatedAt: 1000,
      donorRankingsUpdatedAt: 1000,
      settlementResetAt: 500,
      donors: [] as Array<{
        id: string;
        name: string;
        amount: number;
        memberId: string;
        at: number;
        target: "account" | "toon";
      }>,
      members: [{ id: "m1", name: "홍쓰", account: 0, toon: 0, contribution: 0 }],
    };
    const remote = {
      ...defaultState(),
      updatedAt: 2000,
      donorRankingsUpdatedAt: 2500,
      settlementResetAt: 500,
      donors: [
        {
          id: "toonation:new",
          name: "시드",
          amount: 120000,
          memberId: "m1",
          at: 2000,
          target: "toon" as const,
        },
      ],
      members: [{ id: "m1", name: "홍쓰", account: 0, toon: 120000, contribution: 120000 }],
    };
    expect(shouldRejectPoorerDonationRemote(local, remote)).toBe(false);
  });
});

describe("isRicherDonationSnapshot", () => {
  it("detects higher toon even when account is equal", async () => {
    const { isRicherDonationSnapshot } = await import("@/lib/overlay-sync-signature");
    const base = defaultState();
    const a = {
      ...base,
      members: (base.members || []).map((m, i) =>
        i === 0 ? { ...m, account: 100_000, toon: 0 } : m
      ),
    };
    const b = {
      ...base,
      members: (base.members || []).map((m, i) =>
        i === 0 ? { ...m, account: 100_000, toon: 100_000 } : m
      ),
    };
    expect(isRicherDonationSnapshot(b, a)).toBe(true);
    expect(isRicherDonationSnapshot(a, b)).toBe(false);
  });
});

describe("buildSigSalesOverlaySyncSignature", () => {
  it("changes when manual one-shot image URL changes", () => {
    const base = defaultState();
    const a = {
      ...base,
      overlaySettings: {
        [MANUAL_SIG_DRAFT_STATE_KEY]: { oneShotImageUrl: "/uploads/sigs/u/a.gif" },
      },
    };
    const b = {
      ...a,
      overlaySettings: {
        [MANUAL_SIG_DRAFT_STATE_KEY]: { oneShotImageUrl: "/uploads/sigs/u/b.gif" },
      },
    };
    expect(buildSigSalesOverlaySyncSignature(a)).not.toBe(buildSigSalesOverlaySyncSignature(b));
  });
});
