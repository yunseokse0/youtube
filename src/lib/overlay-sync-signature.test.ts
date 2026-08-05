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
