import type { AppState, SigItem } from "@/types";
import { normalizeSigInventory } from "@/lib/constants";
import { isManualOverlaySessionId } from "@/lib/sig-sales-manual-round";

/** 수동 판매 방송 전용 — `rouletteState`와 완전 분리 */
export const MANUAL_SIG_BROADCAST_STATE_KEY = "sigSalesManualBroadcastV1";

export type ManualSigBroadcastPhase = "IDLE" | "LANDED" | "CONFIRMED";

export type ManualSigOneShotResult = {
  id: string;
  name: string;
  price: number;
};

export type ManualSigBroadcastPersist = {
  phase: ManualSigBroadcastPhase;
  startedAt: number;
  selectedSigs: SigItem[];
  oneShotResult: ManualSigOneShotResult | null;
  overlayReloadNonce: number;
  lastFinishedAt?: number;
};

export function defaultManualSigBroadcast(): ManualSigBroadcastPersist {
  return {
    phase: "IDLE",
    startedAt: 0,
    selectedSigs: [],
    oneShotResult: null,
    overlayReloadNonce: 0,
  };
}

function normalizeOneShot(raw: unknown): ManualSigOneShotResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const price = Math.max(0, Math.floor(Number(o.price || 0)));
  if (price < 0) return null;
  return {
    id: String(o.id || "sig_one_shot"),
    name: String(o.name || "한방 시그").trim() || "한방 시그",
    price,
  };
}

export function normalizeManualSigBroadcastPersist(raw: unknown): ManualSigBroadcastPersist | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const phaseRaw = String(o.phase || "").toUpperCase();
  const phase: ManualSigBroadcastPhase =
    phaseRaw === "LANDED" || phaseRaw === "CONFIRMED" ? phaseRaw : "IDLE";
  const selectedSigs = Array.isArray(o.selectedSigs)
    ? normalizeSigInventory(o.selectedSigs.filter((x) => x && typeof x === "object") as unknown[])
    : [];
  return {
    phase,
    startedAt: Number.isFinite(Number(o.startedAt))
      ? Math.max(0, Math.floor(Number(o.startedAt)))
      : 0,
    selectedSigs,
    oneShotResult: normalizeOneShot(o.oneShotResult),
    overlayReloadNonce: Number.isFinite(Number(o.overlayReloadNonce))
      ? Math.max(0, Math.floor(Number(o.overlayReloadNonce)))
      : 0,
    ...(Number.isFinite(Number(o.lastFinishedAt)) && Number(o.lastFinishedAt) > 0
      ? { lastFinishedAt: Math.floor(Number(o.lastFinishedAt)) }
      : {}),
  };
}

/** 구버전 `rouletteState`(manual_* 세션) → broadcast 마이그레이션 읽기 */
function legacyManualBroadcastFromRoulette(state: AppState | null | undefined): ManualSigBroadcastPersist | null {
  const rs = state?.rouletteState;
  if (!rs || !isManualOverlaySessionId(rs.sessionId)) return null;
  const phaseRaw = String(rs.phase || "").toUpperCase();
  const phase: ManualSigBroadcastPhase =
    phaseRaw === "LANDED"
      ? "LANDED"
      : phaseRaw === "CONFIRMED" || phaseRaw === "CONFIRM_PENDING"
        ? "CONFIRMED"
        : "IDLE";
  const selectedSigs = (
    Array.isArray(rs.selectedSigs) && rs.selectedSigs.length > 0
      ? rs.selectedSigs
      : Array.isArray(rs.results)
        ? rs.results
        : []
  ) as SigItem[];
  if (phase === "IDLE" && selectedSigs.length === 0 && !rs.oneShotResult) return null;
  return {
    phase,
    startedAt: Number(rs.startedAt || 0),
    selectedSigs,
    oneShotResult: rs.oneShotResult
      ? {
          id: String(rs.oneShotResult.id || "sig_one_shot"),
          name: String(rs.oneShotResult.name || "한방 시그"),
          price: Math.max(0, Math.floor(Number(rs.oneShotResult.price || 0))),
        }
      : null,
    overlayReloadNonce: Number(rs.overlayReloadNonce || 0),
    ...(rs.lastFinishedAt ? { lastFinishedAt: Number(rs.lastFinishedAt) } : {}),
  };
}

export function readManualSigBroadcastFromState(
  state: AppState | null | undefined
): ManualSigBroadcastPersist | null {
  const os = state?.overlaySettings;
  if (os && typeof os === "object") {
    const raw = (os as Record<string, unknown>)[MANUAL_SIG_BROADCAST_STATE_KEY];
    const normalized = normalizeManualSigBroadcastPersist(raw);
    if (normalized) return normalized;
  }
  return legacyManualBroadcastFromRoulette(state);
}

export function manualSigBroadcastReloadNonce(state: AppState | null | undefined): number {
  return Number(readManualSigBroadcastFromState(state)?.overlayReloadNonce || 0);
}

export function manualSigBroadcastPhase(state: AppState | null | undefined): ManualSigBroadcastPhase {
  return readManualSigBroadcastFromState(state)?.phase ?? "IDLE";
}

export function isManualSigBroadcastTerminalPhase(state: AppState | null | undefined): boolean {
  const phase = manualSigBroadcastPhase(state);
  return phase === "LANDED" || phase === "CONFIRMED";
}

export function mergeManualSigBroadcastIntoOverlaySettings(
  base: AppState | null | undefined,
  broadcast: ManualSigBroadcastPersist
): AppState["overlaySettings"] {
  const prev =
    base?.overlaySettings && typeof base.overlaySettings === "object"
      ? (base.overlaySettings as Record<string, unknown>)
      : {};
  return {
    ...prev,
    [MANUAL_SIG_BROADCAST_STATE_KEY]: broadcast,
  } as AppState["overlaySettings"];
}

export function buildManualSigBroadcastLandPatch(
  base: AppState,
  selected: SigItem[],
  oneShot: ManualSigOneShotResult
): ManualSigBroadcastPersist {
  const now = Date.now();
  const prev = readManualSigBroadcastFromState(base);
  return {
    phase: "LANDED",
    startedAt: now,
    selectedSigs: selected,
    oneShotResult: oneShot,
    overlayReloadNonce: Number(prev?.overlayReloadNonce || 0) + 1,
  };
}

export function buildManualSigBroadcastIdleResetPatch(base: AppState): ManualSigBroadcastPersist {
  const now = Date.now();
  const prev = readManualSigBroadcastFromState(base);
  return {
    phase: "IDLE",
    startedAt: now,
    selectedSigs: [],
    oneShotResult: null,
    overlayReloadNonce: Number(prev?.overlayReloadNonce || 0) + 1,
  };
}

export function bumpManualSigBroadcastNonce(
  broadcast: ManualSigBroadcastPersist
): ManualSigBroadcastPersist {
  return {
    ...broadcast,
    overlayReloadNonce: Number(broadcast.overlayReloadNonce || 0) + 1,
  };
}
