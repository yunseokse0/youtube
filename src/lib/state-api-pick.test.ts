import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import {
  projectStateForGetPick,
  STATE_PICK_OVERLAY,
  STATE_PICK_OVERLAY_DONORS,
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
    expect(out.highSocietySettings).toEqual(state.highSocietySettings);
  });

  it("overlay-donors pick includes donors for high-society territory", () => {
    const base = defaultState();
    const state = {
      ...base,
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 20000,
          memberId: "m1",
          target: "account" as const,
          at: 1,
          hsPushDir: "left" as const,
        },
      ],
      highSocietySettings: {
        ...(base.highSocietySettings || { enabled: false, seatMemberIds: [], defaultMiddlePush: "right" as const }),
        enabled: true,
        territoryUpdateMode: "realtime" as const,
      },
    };
    const out = projectStateForGetPick(state, STATE_PICK_OVERLAY_DONORS) as Record<string, unknown>;
    expect(out.donors).toEqual(state.donors);
    expect(out.highSocietySettings).toEqual(state.highSocietySettings);
  });

  it("sig-sales pick is minimal", () => {
    const base = defaultState();
    const out = projectStateForGetPick(base, STATE_PICK_SIG_SALES) as Record<string, unknown>;
    expect(out.members).toBeUndefined();
    expect(out.sigInventory).toBeDefined();
    expect(out.rouletteState).toBeDefined();
  });

  it("sig-sales pick includes manual draft for OBS sold stamps", () => {
    const base = {
      ...defaultState(),
      overlaySettings: {
        sigSalesManualDraftV1: {
          sigSoldFlags: [true, false, false, false, false],
          oneShotMarkSold: true,
        },
      },
    };
    const out = projectStateForGetPick(base, STATE_PICK_SIG_SALES) as Record<string, unknown>;
    const os = out.overlaySettings as Record<string, unknown>;
    expect(os?.sigSalesManualDraftV1).toBeTruthy();
  });
});
