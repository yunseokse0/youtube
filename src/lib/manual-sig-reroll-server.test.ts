import { describe, expect, it } from "vitest";
import { defaultState, buildSigSalesManualApiPatch, mergeSigSalesManualIntoLocalState } from "@/lib/state";
import { MANUAL_SIG_DRAFT_STATE_KEY } from "@/lib/manual-sig-workbench";
import { MANUAL_OVERLAY_SESSION_ID } from "@/lib/sig-sales-manual-round";
import { OBS_TEXT_OVERLAY_STATE_KEY, defaultObsTextRegistry } from "@/lib/obs-text-overlay";
import type { AppState } from "@/types";

/** /api/state/route.ts mergePartialState 핵심 — PATCH 후 서버 동작 시뮬 */
function simulateServerMergePartialState(base: AppState, patch: Partial<AppState>): AppState {
  const next: AppState = { ...base, ...patch };
  if (!("members" in patch)) next.members = base.members;
  if (!("donors" in patch)) next.donors = base.donors;
  if (!("overlayPresets" in patch)) next.overlayPresets = base.overlayPresets;
  if (!("missions" in patch)) next.missions = base.missions;
  if (!("forbiddenWords" in patch)) next.forbiddenWords = base.forbiddenWords;
  if (!("overlaySettings" in patch)) {
    next.overlaySettings = base.overlaySettings;
  } else if (
    patch.overlaySettings &&
    typeof patch.overlaySettings === "object" &&
    base.overlaySettings &&
    typeof base.overlaySettings === "object"
  ) {
    next.overlaySettings = {
      ...(base.overlaySettings as Record<string, unknown>),
      ...(patch.overlaySettings as Record<string, unknown>),
    } as AppState["overlaySettings"];
  }
  return next;
}

describe("manual sig reroll server simulation", () => {
  it("PATCH-only reroll does not reset members donors presets on server merge", () => {
    const server: AppState = {
      ...defaultState(),
      members: [
        { id: "m1", name: "패자", account: 100000, toon: 0, contribution: 100000 },
        { id: "m2", name: "승자", account: 50000, toon: 0, contribution: 50000 },
      ],
      donors: [{ id: "d1", name: "후원자A", amount: 50000, memberId: "m1", at: 1 }],
      overlayPresets: [{ id: "ov1", name: "목표바" }, { id: "ov2", name: "후원순위" }],
      sigInventory: [
        { id: "s1", name: "A", price: 1000, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
        { id: "s2", name: "B", price: 2000, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
        { id: "s3", name: "C", price: 3000, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      ],
    };

    const pick = server.sigInventory.slice(0, 2);
    const rerollNext: AppState = {
      ...server,
      overlaySettings: {
        [MANUAL_SIG_DRAFT_STATE_KEY]: {
          inputMode: "inventory",
          drafts: pick.map((s) => ({
            sourceSigId: s.id,
            name: s.name,
            priceInput: String(s.price),
            imageUrl: "",
          })),
          oneShotName: "한방",
          oneShotPriceInput: "3000",
          oneShotImageUrl: "/images/sigs/한방시그.gif",
          sigSoldFlags: [false, false, false, false, false],
          oneShotMarkSold: false,
        },
      },
      rouletteState: {
        ...server.rouletteState,
        phase: "LANDED",
        sessionId: MANUAL_OVERLAY_SESSION_ID,
        selectedSigs: pick,
        startedAt: Date.now(),
      },
      updatedAt: Date.now(),
    };

    const patch = buildSigSalesManualApiPatch(rerollNext, "finalent");
    expect(patch.members).toBeUndefined();
    expect(patch.donors).toBeUndefined();
    expect(patch.overlayPresets).toBeUndefined();

    const merged = simulateServerMergePartialState(server, patch);
    expect(merged.members).toHaveLength(2);
    expect(merged.members[0]?.name).toBe("패자");
    expect(merged.donors).toHaveLength(1);
    expect(merged.overlayPresets).toHaveLength(2);
    expect(merged.rouletteState?.phase).toBe("LANDED");
  });

  it("PATCH-only reroll does not reset generalTimer on server merge", () => {
    const server: AppState = {
      ...defaultState(),
      generalTimer: {
        remainingTime: 540,
        isActive: true,
        lastUpdated: 1000,
      },
      sigInventory: [
        { id: "s1", name: "A", price: 1000, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
        { id: "s2", name: "B", price: 2000, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      ],
    };
    const pick = server.sigInventory.slice(0, 2);
    const rerollNext: AppState = {
      ...defaultState(),
      sigInventory: server.sigInventory,
      rouletteState: {
        ...server.rouletteState,
        phase: "LANDED",
        sessionId: MANUAL_OVERLAY_SESSION_ID,
        selectedSigs: pick,
        startedAt: Date.now(),
      },
      overlaySettings: {
        [MANUAL_SIG_DRAFT_STATE_KEY]: {
          inputMode: "inventory",
          drafts: pick.map((s) => ({
            sourceSigId: s.id,
            name: s.name,
            priceInput: String(s.price),
            imageUrl: "",
          })),
          oneShotName: "한방",
          oneShotPriceInput: "3000",
          oneShotImageUrl: "/images/sigs/한방시그.gif",
          sigSoldFlags: [false, false, false, false, false],
          oneShotMarkSold: false,
        },
      },
    };
    const patch = buildSigSalesManualApiPatch(rerollNext, "finalent");
    expect(patch.generalTimer).toBeUndefined();
    const merged = simulateServerMergePartialState(server, patch);
    expect(merged.generalTimer?.remainingTime).toBe(540);
    expect(merged.generalTimer?.isActive).toBe(true);
  });

  it("PATCH manual draft preserves obs text overlay registry on server merge", () => {
    const textReg = defaultObsTextRegistry();
    textReg.instances[0]!.config.blocks[0]!.text = "방송 문구 유지";
    const server: AppState = {
      ...defaultState(),
      overlaySettings: {
        [OBS_TEXT_OVERLAY_STATE_KEY]: textReg,
      },
      sigInventory: [
        { id: "s1", name: "A", price: 1000, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
        { id: "s2", name: "B", price: 2000, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      ],
    };
    const pick = server.sigInventory.slice(0, 2);
    const rerollNext: AppState = {
      ...server,
      overlaySettings: {
        ...(server.overlaySettings as Record<string, unknown>),
        [MANUAL_SIG_DRAFT_STATE_KEY]: {
          inputMode: "inventory",
          drafts: pick.map((s) => ({
            sourceSigId: s.id,
            name: s.name,
            priceInput: String(s.price),
            imageUrl: "",
          })),
          oneShotName: "한방",
          oneShotPriceInput: "3000",
          oneShotImageUrl: "/images/sigs/한방시그.gif",
          sigSoldFlags: [false, false, false, false, false],
          oneShotMarkSold: false,
        },
      },
      rouletteState: {
        ...server.rouletteState,
        phase: "LANDED",
        sessionId: MANUAL_OVERLAY_SESSION_ID,
        selectedSigs: pick,
        startedAt: Date.now(),
      },
    };
    const patch = buildSigSalesManualApiPatch(rerollNext, "finalent");
    const merged = simulateServerMergePartialState(server, patch);
    const os = merged.overlaySettings as Record<string, unknown> | undefined;
    const savedText = os?.[OBS_TEXT_OVERLAY_STATE_KEY] as ReturnType<typeof defaultObsTextRegistry> | undefined;
    expect(savedText?.instances[0]?.config.blocks[0]?.text).toBe("방송 문구 유지");
    expect(os?.[MANUAL_SIG_DRAFT_STATE_KEY]).toBeTruthy();
  });

  it("old bug: partial overlaySettings PATCH without merge wipes obs text", () => {
    const server: AppState = {
      ...defaultState(),
      overlaySettings: { [OBS_TEXT_OVERLAY_STATE_KEY]: defaultObsTextRegistry() },
    };
    const broken: AppState = {
      ...server,
      ...{
        overlaySettings: {
          [MANUAL_SIG_DRAFT_STATE_KEY]: { drafts: [], sigSoldFlags: [], oneShotMarkSold: false },
        },
      },
    };
    expect((broken.overlaySettings as Record<string, unknown>)[OBS_TEXT_OVERLAY_STATE_KEY]).toBeUndefined();
  });

  it("old bug: full POST with defaultState members would wipe server (regression doc)", () => {
    const server: AppState = {
      ...defaultState(),
      members: [{ id: "m1", name: "패자", account: 1, toon: 0, contribution: 1 }],
      donors: [{ id: "d1", name: "x", amount: 1, memberId: "m1", at: 1 }],
    };
    const buggyClient = defaultState();
    const merged = simulateServerMergePartialState(server, buggyClient);
    expect(merged.members[0]?.name).not.toBe("패자");
  });

  it("localStorage merge prefers server-loaded next over corrupted base", () => {
    const corrupted = defaultState();
    const fromServer: AppState = {
      ...defaultState(),
      members: [{ id: "m1", name: "패자", account: 999, toon: 0, contribution: 999 }],
      donors: [{ id: "d1", name: "후원", amount: 100, memberId: "m1", at: 1 }],
      sigInventory: corrupted.sigInventory,
    };
    const merged = mergeSigSalesManualIntoLocalState(corrupted, fromServer);
    expect(merged.members[0]?.name).toBe("패자");
  });
});
