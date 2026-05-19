import type { AppState, RouletteState } from "@/types";
import { capDonorsForOverlayWire, slimSigInventoryForWire } from "@/lib/state-wire-slim";

export const STATE_PICK_SIG_INVENTORY = "sigInventory";
export const STATE_PICK_OVERLAY = "overlay";
export const STATE_PICK_OVERLAY_DONORS = "overlay-donors";
export const STATE_PICK_SIG_SALES = "sig-sales";

export type StateApiPick =
  | typeof STATE_PICK_SIG_INVENTORY
  | typeof STATE_PICK_OVERLAY
  | typeof STATE_PICK_OVERLAY_DONORS
  | typeof STATE_PICK_SIG_SALES;

export function parseStateApiPick(raw: string): StateApiPick | null {
  const v = String(raw || "").trim();
  if (
    v === STATE_PICK_SIG_INVENTORY ||
    v === STATE_PICK_OVERLAY ||
    v === STATE_PICK_OVERLAY_DONORS ||
    v === STATE_PICK_SIG_SALES
  ) {
    return v;
  }
  return null;
}

function stripRouletteForOverlay(rs: RouletteState | undefined): RouletteState | undefined {
  if (!rs || typeof rs !== "object") return rs;
  const { historyLogs: _history, ...rest } = rs;
  return rest as RouletteState;
}

function overlayCoreFields(state: AppState, rs: RouletteState | undefined, includeDonors: boolean) {
  return {
    updatedAt: state.updatedAt,
    members: state.members,
    memberPositions: state.memberPositions,
    memberPositionMode: state.memberPositionMode,
    rankPositionLabels: state.rankPositionLabels,
    donorRankingsTheme: state.donorRankingsTheme,
    donorRankingsPresets: state.donorRankingsPresets,
    donorRankingsPresetId: state.donorRankingsPresetId,
    ...(includeDonors ? { donors: capDonorsForOverlayWire(state.donors) } : {}),
    missions: state.missions,
    sigInventory: slimSigInventoryForWire(state.sigInventory),
    sigSoldOutStampUrl: state.sigSoldOutStampUrl,
    rouletteState: rs,
    overlayPresets: state.overlayPresets,
    overlaySettings: state.overlaySettings,
    sigMatch: state.sigMatch,
    sigMatchSettings: state.sigMatchSettings,
    mealBattle: state.mealBattle,
    mealMatch: state.mealMatch,
    mealMatchSettings: state.mealMatchSettings,
    generalTimer: state.generalTimer,
    matchTimerEnabled: state.matchTimerEnabled,
    timerDisplayStyles: state.timerDisplayStyles,
    donorRankingsOverlayConfig: state.donorRankingsOverlayConfig,
    donationListsOverlayConfig: state.donationListsOverlayConfig,
    sigSalesExcludedIds: state.sigSalesExcludedIds,
    donationSyncMode: state.donationSyncMode,
    sigRolling: state.sigRolling,
    sigRollingMeta: state.sigRollingMeta,
  };
}

/**
 * GET /api/state?pick=… — 응답 본문 축소(관리자는 pick 없이 전체).
 */
export function projectStateForGetPick(state: AppState, pick: StateApiPick): unknown {
  if (pick === STATE_PICK_SIG_INVENTORY) {
    return {
      updatedAt: state.updatedAt,
      sigInventory: slimSigInventoryForWire(state.sigInventory),
    };
  }
  const rs = stripRouletteForOverlay(state.rouletteState);
  if (pick === STATE_PICK_SIG_SALES) {
    return {
      updatedAt: state.updatedAt,
      sigInventory: slimSigInventoryForWire(state.sigInventory),
      sigSalesExcludedIds: state.sigSalesExcludedIds,
      sigSoldOutStampUrl: state.sigSoldOutStampUrl,
      sigRollingMeta: state.sigRollingMeta,
      rouletteState: rs,
    };
  }
  if (pick === STATE_PICK_OVERLAY) {
    return overlayCoreFields(state, rs, false);
  }
  return overlayCoreFields(state, rs, true);
}

/** pick=overlay* 부분 JSON → 클라이언트 AppState 병합용 */
export function isOverlayPickPartial(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  return "updatedAt" in o && !("forbiddenWords" in o) && !("contributionLogs" in o);
}
