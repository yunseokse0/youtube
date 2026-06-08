import type { AppState, RouletteState } from "@/types";
import { readDonorRankingsRevision } from "@/lib/donor-rankings-rev";
import {
  OBS_TEXT_OVERLAY_STATE_KEY,
  readObsTextRegistryFromState,
} from "@/lib/obs-text-overlay";
import { capDonorsForOverlayWire, slimSigInventoryForWire } from "@/lib/state-wire-slim";

export const STATE_PICK_SIG_INVENTORY = "sigInventory";
export const STATE_PICK_OVERLAY = "overlay";
export const STATE_PICK_OVERLAY_DONORS = "overlay-donors";
export const STATE_PICK_SIG_SALES = "sig-sales";
const MANUAL_SIG_DRAFT_STATE_KEY = "sigSalesManualDraftV1";
export const STATE_PICK_DONOR_RANKINGS = "donor-rankings";
export const STATE_PICK_OBS_TEXT = "obs-text";

function overlayPickRevision(state: AppState): number {
  return Math.max(Number(state.updatedAt || 0), readDonorRankingsRevision(state));
}

export type StateApiPick =
  | typeof STATE_PICK_SIG_INVENTORY
  | typeof STATE_PICK_OVERLAY
  | typeof STATE_PICK_OVERLAY_DONORS
  | typeof STATE_PICK_SIG_SALES
  | typeof STATE_PICK_DONOR_RANKINGS
  | typeof STATE_PICK_OBS_TEXT;

export function parseStateApiPick(raw: string): StateApiPick | null {
  const v = String(raw || "").trim();
  if (
    v === STATE_PICK_SIG_INVENTORY ||
    v === STATE_PICK_OVERLAY ||
    v === STATE_PICK_OVERLAY_DONORS ||
    v === STATE_PICK_SIG_SALES ||
    v === STATE_PICK_DONOR_RANKINGS ||
    v === STATE_PICK_OBS_TEXT
  ) {
    return v;
  }
  return null;
}

/** pick별 304·since 비교에 쓸 revision */
export function revisionForStatePick(state: AppState, pick: StateApiPick): number {
  if (pick === STATE_PICK_DONOR_RANKINGS) return readDonorRankingsRevision(state);
  if (pick === STATE_PICK_OBS_TEXT) {
    const reg = readObsTextRegistryFromState(state);
    let rev = Number(state.updatedAt || 0);
    for (const inst of reg.instances) {
      rev = Math.max(rev, Number(inst.config.revision || 0));
    }
    return rev;
  }
  if (pick === STATE_PICK_OVERLAY || pick === STATE_PICK_OVERLAY_DONORS) {
    return overlayPickRevision(state);
  }
  return Number(state.updatedAt || 0);
}

function stripRouletteForOverlay(rs: RouletteState | undefined): RouletteState | undefined {
  if (!rs || typeof rs !== "object") return rs;
  const { historyLogs: _history, ...rest } = rs;
  return rest as RouletteState;
}

function overlayCoreFields(
  state: AppState,
  rs: RouletteState | undefined,
  includeDonors: boolean,
  userId?: string
) {
  return {
    updatedAt: state.updatedAt,
    members: state.members,
    memberPositions: state.memberPositions,
    memberPositionMode: state.memberPositionMode,
    rankPositionLabels: state.rankPositionLabels,
    donorsFormat: state.donorsFormat,
    donorRankingsTheme: state.donorRankingsTheme,
    donorRankingsFullTheme: state.donorRankingsFullTheme,
    donorRankingsPresets: state.donorRankingsPresets,
    donorRankingsPresetId: state.donorRankingsPresetId,
    ...(includeDonors ? { donors: capDonorsForOverlayWire(state.donors) } : {}),
    missions: state.missions,
    sigInventory: slimSigInventoryForWire(state.sigInventory, userId),
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
    donorRankingsFullOverlayConfig: state.donorRankingsFullOverlayConfig,
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
export function projectStateForGetPick(
  state: AppState,
  pick: StateApiPick,
  userId?: string
): unknown {
  if (pick === STATE_PICK_SIG_INVENTORY) {
    return {
      updatedAt: state.updatedAt,
      sigInventory: slimSigInventoryForWire(state.sigInventory, userId),
    };
  }
  const rs = stripRouletteForOverlay(state.rouletteState);
  if (pick === STATE_PICK_SIG_SALES) {
    const os = state.overlaySettings;
    const manualDraft =
      os && typeof os === "object"
        ? (os as Record<string, unknown>)[MANUAL_SIG_DRAFT_STATE_KEY]
        : undefined;
    return {
      updatedAt: state.updatedAt,
      sigInventory: slimSigInventoryForWire(state.sigInventory, userId),
      sigSalesExcludedIds: state.sigSalesExcludedIds,
      sigSoldOutStampUrl: state.sigSoldOutStampUrl,
      sigRollingMeta: state.sigRollingMeta,
      rouletteState: rs,
      /** OBS 수동 모드: 관리자 「판매완료」체크·한방 플래그(로컬스토리지 없음) */
      ...(manualDraft && typeof manualDraft === "object"
        ? { overlaySettings: { [MANUAL_SIG_DRAFT_STATE_KEY]: manualDraft } }
        : {}),
    };
  }
  if (pick === STATE_PICK_OVERLAY) {
    return {
      ...overlayCoreFields(state, rs, false, userId),
      donorRankingsUpdatedAt: overlayPickRevision(state),
    };
  }
  if (pick === STATE_PICK_DONOR_RANKINGS) {
    return {
      updatedAt: state.updatedAt,
      donorRankingsUpdatedAt: revisionForStatePick(state, STATE_PICK_DONOR_RANKINGS),
      donors: capDonorsForOverlayWire(state.donors),
      donorsFormat: state.donorsFormat,
      donorRankingsTheme: state.donorRankingsTheme,
      donorRankingsFullTheme: state.donorRankingsFullTheme,
      donorRankingsPresets: state.donorRankingsPresets,
      donorRankingsPresetId: state.donorRankingsPresetId,
      donorRankingsOverlayConfig: state.donorRankingsOverlayConfig,
      donorRankingsFullOverlayConfig: state.donorRankingsFullOverlayConfig,
    };
  }
  if (pick === STATE_PICK_OBS_TEXT) {
    const os = state.overlaySettings;
    const obsText =
      os && typeof os === "object"
        ? (os as Record<string, unknown>)[OBS_TEXT_OVERLAY_STATE_KEY]
        : undefined;
    return {
      updatedAt: state.updatedAt,
      ...(obsText && typeof obsText === "object"
        ? { overlaySettings: { [OBS_TEXT_OVERLAY_STATE_KEY]: obsText } }
        : {}),
    };
  }
  return {
    ...overlayCoreFields(state, rs, true, userId),
    donorRankingsUpdatedAt: overlayPickRevision(state),
  };
}

/** pick=overlay*·donor-rankings 부분 JSON → 클라이언트 AppState 병합용 */
export function isOverlayPickPartial(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  return "updatedAt" in o && !("forbiddenWords" in o) && !("contributionLogs" in o);
}

export function isDonorRankingsPickPartial(data: unknown): boolean {
  if (!isOverlayPickPartial(data)) return false;
  return "donors" in (data as Record<string, unknown>);
}
