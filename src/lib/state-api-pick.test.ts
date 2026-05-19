import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import {
  projectStateForGetPick,
  STATE_PICK_OVERLAY,
  STATE_PICK_SIG_SALES,
} from "@/lib/state-api-pick";

describe("state-api-pick", () => {
  it("overlay pick omits admin-only heavy fields", () => {
    const base = defaultState();
    const state = {
      ...base,
      contributionLogs: [{ id: "1", memberId: "m", delta: 1 as const, at: 1, amount: 100 }],
      forbiddenWords: ["bad"],
      sigSalesMemberPresets: { m1: ["s1"] },
      rouletteState: {
        ...base.rouletteState,
        historyLogs: [
          {
            id: "h1",
            sessionId: "s",
            phase: "CONFIRMED" as const,
            selectedSigs: [],
            selectedSigIds: [],
            oneShotPrice: 0,
            totalPrice: 0,
            timestamp: 1,
          },
        ],
      },
    };
    const out = projectStateForGetPick(state, STATE_PICK_OVERLAY) as Record<string, unknown>;
    expect(out.contributionLogs).toBeUndefined();
    expect(out.forbiddenWords).toBeUndefined();
    expect(out.sigSalesMemberPresets).toBeUndefined();
    const rs = out.rouletteState as Record<string, unknown>;
    expect(rs.historyLogs).toBeUndefined();
    expect(out.members).toEqual(state.members);
    expect(out.donors).toBeUndefined();
  });

  it("sig-sales pick is minimal", () => {
    const base = defaultState();
    const out = projectStateForGetPick(base, STATE_PICK_SIG_SALES) as Record<string, unknown>;
    expect(out.members).toBeUndefined();
    expect(out.sigInventory).toBeDefined();
    expect(out.rouletteState).toBeDefined();
  });
});
