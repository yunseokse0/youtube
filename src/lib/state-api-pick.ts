import type { AppState, Donor, RouletteState } from "@/types";
import { buildDonorRankingsFromDonors } from "@/lib/donor-rankings-aggregate";
import { readDonorRankingsRevision } from "@/lib/donor-rankings-rev";
import {
  OBS_TEXT_OVERLAY_STATE_KEY,
  readObsTextRegistryFromState,
} from "@/lib/obs-text-overlay";
import { slimSigInventoryForWire } from "@/lib/state-wire-slim";
import {
  MANUAL_SIG_DRAFT_STATE_KEY,
  MANUAL_SIG_GRID_COLS_KEY,
  MANUAL_SIG_GRID_ROWS_KEY,
  MANUAL_SIG_PANEL_ORIENTATION_KEY,
  MANUAL_SIG_PICK_COUNT_KEY,
  MANUAL_SIG_SLOT_PRICE_BANDS_KEY,
} from "@/lib/manual-sig-workbench";
import {
  MANUAL_SIG_OVERLAY_THEME_KEY,
  MANUAL_SIG_THEME_PRESET_KEY,
} from "@/lib/sig-sales-overlay-urls";

export const STATE_PICK_SIG_INVENTORY = "sigInventory";
export const STATE_PICK_OVERLAY = "overlay";
export const STATE_PICK_OVERLAY_DONORS = "overlay-donors";
export const STATE_PICK_SIG_SALES = "sig-sales";
const MANUAL_SIG_BROADCAST_STATE_KEY = "sigSalesManualBroadcastV1";
export const STATE_PICK_DONOR_RANKINGS = "donor-rankings";
export const STATE_PICK_OBS_TEXT = "obs-text";

function overlayTerritoryLogsRevision(state: AppState): number {
  const logs = Array.isArray(state.territoryLogs) ? state.territoryLogs : [];
  let rev = Number(state.highSocietySettings?.territoryLogsResetAt || 0);
  rev = Math.max(rev, logs.length);
  for (const log of logs) {
    rev = Math.max(rev, Number(log.at || 0));
  }
  return rev;
}

function overlayPickRevision(state: AppState): number {
  return Math.max(
    Number(state.updatedAt || 0),
    Number(state.membersRosterUpdatedAt || 0),
    readDonorRankingsRevision(state),
    overlayTerritoryLogsRevision(state)
  );
}

function isZubzubBonusDonor(donor: Donor): boolean {
  return Boolean(
    donor.isZubzubBonus || String(donor.id || "").startsWith("zubzub_bonus_")
  );
}

function overlayZubzubContributionLogs(state: AppState) {
  const logs = (state.contributionLogs || [])
    .filter((log) => log.isZubzubBonus)
    .map((log) => ({ ...log }));
  const knownIds = new Set(logs.map((log) => log.id));
  const knownQueueIds = new Set(
    logs.map((log) => String(log.zubzubQueueId || "")).filter(Boolean)
  );
  for (const donor of state.donors || []) {
    if (!isZubzubBonusDonor(donor)) continue;
    const queueId =
      String(donor.zubzubQueueId || "").trim() ||
      String(donor.id || "").replace(/^zubzub_bonus_/, "").trim();
    const id = `zubzub_bonus_${queueId || donor.id}`;
    if (knownIds.has(id) || (queueId && knownQueueIds.has(queueId))) continue;
    const amount = Math.max(
      0,
      Math.round(Number(donor.sigPrice || donor.contributionPoints || donor.amount) || 0)
    );
    if (!donor.memberId || amount <= 0) continue;
    logs.push({
      id,
      memberId: donor.memberId,
      amount,
      delta: 1 as const,
      donorName: donor.donorName || "대표 시그 줍줍",
      note: donor.message || donor.name || "대표 시그 줍줍 보너스",
      at: Number(donor.at) || 0,
      isZubzubBonus: true,
      zubzubQueueId: queueId || undefined,
      pongdangMinus: Boolean(donor.pongdangMinus),
    });
    knownIds.add(id);
    if (queueId) knownQueueIds.add(queueId);
  }
  return logs;
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

/**
 * 후원순위 GET 304 — 엑셀표(overlay)와 같이 updatedAt 도 본다.
 * donorRankingsUpdatedAt 만 쓰면 후원·멤버 합계는 올랐는데 순위 폴링이 304에 고착된다(OBS는 SSE 없음).
 */
export function donorRankingsPickRevision(state: AppState): number {
  return Math.max(
    Number(state.updatedAt || 0),
    Number(state.donorRankingsUpdatedAt || 0)
  );
}

/** pick별 304·since 비교에 쓸 revision */
export function revisionForStatePick(state: AppState, pick: StateApiPick): number {
  if (pick === STATE_PICK_DONOR_RANKINGS) return donorRankingsPickRevision(state);
  if (pick === STATE_PICK_OBS_TEXT) {
    /** 텍스트 내용 revision 만 — updatedAt 을 섞으면 후원·타이머 저장마다 OBS가 다시 받아 깜빡임 */
    const reg = readObsTextRegistryFromState(state);
    let rev = 0;
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
    settlementResetAt: state.settlementResetAt,
    membersRosterUpdatedAt: state.membersRosterUpdatedAt,
    members: state.members,
    memberPositions: state.memberPositions,
    memberPositionMode: state.memberPositionMode,
    memberRankingMetric: state.memberRankingMetric || "contribution",
    memberCustomCells: state.memberCustomCells || {},
    memberCustomHeaderLabel: state.memberCustomHeaderLabel || "상벌금",
    rankPositionLabels: state.rankPositionLabels,
    fixedPositionMemberIds: state.fixedPositionMemberIds || [],
    contributionExcludedMemberIds: state.contributionExcludedMemberIds || [],
    zubzubSettings: state.zubzubSettings,
    zubzubWaitingItems: state.zubzubWaitingItems || [],
    zubzubContributionLogs: overlayZubzubContributionLogs(state),
    contributionLogs: overlayZubzubContributionLogs(state),
    pongdangResetAt: state.pongdangResetAt,
    pongdangManualMode: state.pongdangManualMode,
    pongdangManualContributions: state.pongdangManualContributions || {},
    tableSplit: (state as unknown as Record<string, unknown>).tableSplit,
    showRankColumn: state.showRankColumn,
    showRoleColumn: state.showRoleColumn,
    donationTableOptions: state.donationTableOptions,
    customColumnName: (state as unknown as Record<string, unknown>).customColumnName,
    rankCustomCells: state.rankCustomCells || [],
    donorsFormat: state.donorsFormat,
    donorRankingsTheme: state.donorRankingsTheme,
    donorRankingsFullTheme: state.donorRankingsFullTheme,
    donorRankingsPresets: state.donorRankingsPresets,
    donorRankingsPresetId: state.donorRankingsPresetId,
    ...(includeDonors
      ? { donors: (state.donors || []).filter((donor) => !isZubzubBonusDonor(donor)) }
      : {}),
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
    matchTimer: state.matchTimer,
    matchTimerEnabled: state.matchTimerEnabled,
    timerDisplayStyles: state.timerDisplayStyles,
    donorRankingsOverlayConfig: state.donorRankingsOverlayConfig,
    donorRankingsFullOverlayConfig: state.donorRankingsFullOverlayConfig,
    donationListsOverlayConfig: state.donationListsOverlayConfig,
    sigSalesExcludedIds: state.sigSalesExcludedIds,
    donationSyncMode: state.donationSyncMode,
    contributionFormula: state.contributionFormula,
    sigRolling: state.sigRolling,
    sigRollingMeta: state.sigRollingMeta,
    /** 상류사회 영토 — 실시간 모드·좌석·후원 방향 반영에 필요 */
    highSocietySettings: state.highSocietySettings,
    /** 수동 영토 기록부 — OBS(host=obs)는 LS 없이 API만 사용 */
    territoryLogs: state.territoryLogs || [],
    deletedTerritoryLogIds: state.deletedTerritoryLogIds || [],
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
    const manualBroadcast =
      os && typeof os === "object"
        ? (os as Record<string, unknown>)[MANUAL_SIG_BROADCAST_STATE_KEY]
        : undefined;
    const overlayManual: Record<string, unknown> = {};
    if (manualDraft && typeof manualDraft === "object") {
      overlayManual[MANUAL_SIG_DRAFT_STATE_KEY] = manualDraft;
    }
    if (manualBroadcast && typeof manualBroadcast === "object") {
      overlayManual[MANUAL_SIG_BROADCAST_STATE_KEY] = manualBroadcast;
    }
    if (os && typeof os === "object") {
      const rec = os as Record<string, unknown>;
      for (const key of [
        MANUAL_SIG_PICK_COUNT_KEY,
        MANUAL_SIG_GRID_ROWS_KEY,
        MANUAL_SIG_GRID_COLS_KEY,
        MANUAL_SIG_PANEL_ORIENTATION_KEY,
        MANUAL_SIG_SLOT_PRICE_BANDS_KEY,
        /** OBS 당첨/네온메뉴 테마 — 빠지면 항상 result 로 고정됨 */
        MANUAL_SIG_OVERLAY_THEME_KEY,
        /** 수동 시그 비주얼 테마 프리셋 */
        MANUAL_SIG_THEME_PRESET_KEY,
      ]) {
        if (rec[key] != null && rec[key] !== "") overlayManual[key] = rec[key];
      }
    }
    return {
      updatedAt: state.updatedAt,
      sigInventory: slimSigInventoryForWire(state.sigInventory, userId),
      sigSalesExcludedIds: state.sigSalesExcludedIds,
      sigSoldOutStampUrl: state.sigSoldOutStampUrl,
      sigRolling: state.sigRolling,
      sigRollingMeta: state.sigRollingMeta,
      members: (state.members || []).map((m) => ({ id: m.id, name: String(m.name || "") })),
      /** 회전판 오버레이용 — 수동 방송과 분리 */
      rouletteState: rs,
      /** 수동 OBS: 초안·방송 상태(당첨·phase·nonce) */
      ...(Object.keys(overlayManual).length > 0 ? { overlaySettings: overlayManual } : {}),
    };
  }
  if (pick === STATE_PICK_OVERLAY) {
    return {
      ...overlayCoreFields(state, rs, false, userId),
      donorRankingsUpdatedAt: overlayPickRevision(state),
    };
  }
  if (pick === STATE_PICK_DONOR_RANKINGS) {
    const realDonors = (state.donors || []).filter((donor) => !isZubzubBonusDonor(donor));
    const rankings = buildDonorRankingsFromDonors(
      realDonors as Array<Record<string, unknown>>,
      0
    );
    return {
      updatedAt: state.updatedAt,
      settlementResetAt: state.settlementResetAt,
      donorRankingsUpdatedAt: revisionForStatePick(state, STATE_PICK_DONOR_RANKINGS),
      donors: realDonors,
      donorsFormat: state.donorsFormat,
      donorRankingsWire: {
        unifiedTop: rankings.unifiedTop,
        accountTop: rankings.accountTop,
        toonTop: rankings.toonTop,
      },
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
  const o = data as Record<string, unknown>;
  return "donors" in o || "donorRankingsWire" in o;
}
