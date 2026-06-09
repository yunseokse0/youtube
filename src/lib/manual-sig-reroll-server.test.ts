import { describe, expect, it } from "vitest";
import {
  defaultState,
  buildSigSalesManualApiPatch,
  mergeSigSalesManualIntoLocalState,
  normalizeRouletteState,
} from "@/lib/state";
import { MANUAL_SIG_BROADCAST_STATE_KEY } from "@/lib/manual-sig-broadcast-state";
import { MANUAL_SIG_DRAFT_STATE_KEY } from "@/lib/manual-sig-workbench";
import {
  MANUAL_OVERLAY_SESSION_ID,
  buildManualRoundResetPatch,
  isManualOverlaySessionId,
} from "@/lib/sig-sales-manual-round";
import { OBS_TEXT_OVERLAY_STATE_KEY, defaultObsTextRegistry } from "@/lib/obs-text-overlay";
import type { AppState, RouletteState } from "@/types";

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

/** route.ts mergePartialState — rouletteState 분기(수동 리셋·리롤 회귀) */
function simulateServerRouletteMerge(base: AppState, patch: Partial<AppState>): AppState {
  const next: AppState = { ...base, ...patch };
  const patchRsEarly =
    patch.rouletteState != null && typeof patch.rouletteState === "object"
      ? (patch.rouletteState as Partial<RouletteState>)
      : null;
  const baseStartedAt = Number(base.rouletteState?.startedAt || 0);
  const patchStartedAt = Number(patchRsEarly?.startedAt || 0);
  const patchHasRollingFlag = typeof patchRsEarly?.isRolling === "boolean";
  const patchReloadNonce = Number(patchRsEarly?.overlayReloadNonce || 0);
  const baseReloadNonce = Number(base.rouletteState?.overlayReloadNonce || 0);
  const manualNonceAdvanced =
    patchRsEarly != null &&
    isManualOverlaySessionId(patchRsEarly.sessionId) &&
    patchReloadNonce > baseReloadNonce;
  const canApplyPatchRouletteState =
    "rouletteState" in patch &&
    (manualNonceAdvanced ||
      (Number.isFinite(patchStartedAt) &&
        (patchStartedAt > baseStartedAt ||
          (patchStartedAt === baseStartedAt && patchHasRollingFlag))));
  if (!canApplyPatchRouletteState) {
    next.rouletteState = base.rouletteState;
  }
  if ("rouletteState" in patch && patch.rouletteState != null && typeof patch.rouletteState === "object") {
    const patchRs = patch.rouletteState as Partial<RouletteState>;
    const isManualRoulettePatch =
      isManualOverlaySessionId(patchRs.sessionId) &&
      (patchRs.phase === "LANDED" ||
        patchRs.phase === "CONFIRMED" ||
        patchRs.phase === "CONFIRM_PENDING" ||
        (patchRs.phase === "IDLE" && manualNonceAdvanced));
    if (isManualRoulettePatch && canApplyPatchRouletteState) {
      const mergedRs = {
        ...(next.rouletteState || base.rouletteState),
        ...patchRs,
      };
      if (patchRs.phase === "IDLE" && manualNonceAdvanced) {
        mergedRs.selectedSigs = undefined;
        mergedRs.results = undefined;
        mergedRs.result = null;
        mergedRs.oneShotResult = null;
      }
      next.rouletteState = normalizeRouletteState(mergedRs);
    }
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
        [MANUAL_SIG_BROADCAST_STATE_KEY]: {
          phase: "LANDED",
          startedAt: Date.now(),
          selectedSigs: pick,
          oneShotResult: { id: "sig_one_shot", name: "한방", price: 3000 },
          overlayReloadNonce: 1,
        },
      },
      updatedAt: Date.now(),
    };

    const patch = buildSigSalesManualApiPatch(rerollNext, "finalent");
    expect(patch.members).toBeUndefined();
    expect(patch.donors).toBeUndefined();
    expect(patch.overlayPresets).toBeUndefined();
    expect(patch.rouletteState).toBeUndefined();

    const merged = simulateServerMergePartialState(server, patch);
    expect(merged.members).toHaveLength(2);
    expect(merged.members[0]?.name).toBe("패자");
    expect(merged.donors).toHaveLength(1);
    expect(merged.overlayPresets).toHaveLength(2);
    const os = merged.overlaySettings as Record<string, unknown> | undefined;
    const broadcast = os?.[MANUAL_SIG_BROADCAST_STATE_KEY] as { phase?: string } | undefined;
    expect(broadcast?.phase).toBe("LANDED");
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

  it("manual reset IDLE clears broadcast selectedSigs without touching rouletteState", () => {
    const oldPick: AppState["sigInventory"] = [
      { id: "s1", name: "맛있쥬", price: 18300, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "s2", name: "팬티맛있엉", price: 45300, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "s3", name: "멸치", price: 45300, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "s4", name: "그루비", price: 88300, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "s5", name: "솜사탕", price: 26500, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
    ];
    const server: AppState = {
      ...defaultState(),
      sigInventory: oldPick,
      rouletteState: {
        ...defaultState().rouletteState,
        phase: "LANDED",
        sessionId: MANUAL_OVERLAY_SESSION_ID,
        startedAt: 1_700_000_000_000,
        overlayReloadNonce: 4,
        selectedSigs: oldPick,
        results: oldPick,
      },
    };
    const resetPatch = buildManualRoundResetPatch(server);
    const merged = simulateServerMergePartialState(server, resetPatch);
    const os = merged.overlaySettings as Record<string, unknown> | undefined;
    const broadcast = os?.[MANUAL_SIG_BROADCAST_STATE_KEY] as
      | { phase?: string; selectedSigs?: unknown[]; overlayReloadNonce?: number }
      | undefined;
    expect(broadcast?.phase).toBe("IDLE");
    expect(broadcast?.selectedSigs).toEqual([]);
    expect(broadcast?.overlayReloadNonce).toBe(5);
    expect(merged.rouletteState?.phase).toBe("LANDED");
    expect(merged.rouletteState?.selectedSigs?.length).toBe(5);
  });

  it("manual reroll PATCH updates broadcast without rouletteState", () => {
    const oldPick = [
      { id: "s1", name: "맛있쥬", price: 18300, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "s2", name: "팬티맛있엉", price: 45300, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "s3", name: "멸치", price: 45300, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "s4", name: "그루비", price: 88300, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "s5", name: "솜사탕", price: 26500, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
    ];
    const newPick = [
      { id: "n1", name: "신규1", price: 11100, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "n2", name: "신규2", price: 22200, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "n3", name: "신규3", price: 33300, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "n4", name: "신규4", price: 44400, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      { id: "n5", name: "신규5", price: 55500, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
    ];
    const server: AppState = {
      ...defaultState(),
      sigInventory: [...oldPick, ...newPick],
      rouletteState: {
        ...defaultState().rouletteState,
        phase: "LANDED",
        sessionId: MANUAL_OVERLAY_SESSION_ID,
        startedAt: 1_700_000_000_000,
        overlayReloadNonce: 4,
        selectedSigs: oldPick,
      },
    };
    const rerollNext: AppState = {
      ...server,
      overlaySettings: {
        [MANUAL_SIG_BROADCAST_STATE_KEY]: {
          phase: "LANDED",
          startedAt: Date.now(),
          selectedSigs: newPick,
          oneShotResult: { id: "sig_one_shot", name: "한방", price: 166500 },
          overlayReloadNonce: 5,
        },
      },
    };
    const patch = buildSigSalesManualApiPatch(rerollNext, "finalent");
    expect(patch.rouletteState).toBeUndefined();
    const merged = simulateServerMergePartialState(server, patch);
    const os = merged.overlaySettings as Record<string, unknown> | undefined;
    const broadcast = os?.[MANUAL_SIG_BROADCAST_STATE_KEY] as
      | { selectedSigs?: Array<{ name?: string }> }
      | undefined;
    expect(broadcast?.selectedSigs?.map((s) => s.name)).toEqual(newPick.map((s) => s.name));
    expect(merged.rouletteState?.selectedSigs?.map((s) => s.name)).toEqual(oldPick.map((s) => s.name));
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
