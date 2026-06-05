import { normalizeSigInventory } from "@/lib/constants";
import {
  defaultState,
  normalizeDonationListsOverlayConfig,
  normalizeDonorRankingsOverlayConfig,
  normalizeDonorsArray,
  normalizeDonorsFormat,
  normalizeMemberPositions,
  normalizeRouletteState,
  normalizeSigMatchParticipantIds,
  normalizeSigMatchPools,
  normalizeSigRolling,
  ensureMissionItems,
  type AppState,
  type DailyLogEntry,
} from "@/lib/state";
import type { Member } from "@/types";

/** 관리자 「상태보내기(JSON)」 수준의 전체 백업인지 */
export function isFullBroadcastStateBackup(patch: Record<string, unknown>): boolean {
  if (Array.isArray(patch.members) && patch.members.length > 0) return true;
  if (Array.isArray(patch.overlayPresets) && patch.overlayPresets.length > 0) return true;
  if (patch.overlaySettings && typeof patch.overlaySettings === "object") return true;
  return false;
}

export function summarizeRestoreJson(patch: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (Array.isArray(patch.sigInventory)) lines.push(`시그 ${patch.sigInventory.length}개`);
  if (Array.isArray(patch.members)) lines.push(`멤버 ${patch.members.length}명`);
  if (Array.isArray(patch.donors)) lines.push(`후원 ${patch.donors.length}건`);
  if (Array.isArray(patch.overlayPresets)) lines.push(`오버레이 프리셋 ${patch.overlayPresets.length}개`);
  if (Array.isArray(patch.missions)) lines.push(`미션 ${patch.missions.length}개`);
  if (patch.overlaySettings && typeof patch.overlaySettings === "object") lines.push("오버레이 설정");
  if (patch.donorRankingsTheme && typeof patch.donorRankingsTheme === "object") lines.push("후원순위 테마");
  if (patch.sigRolling || patch.sigRollingMeta) lines.push("시그 롤링");
  if (patch.mealBattle && typeof patch.mealBattle === "object") lines.push("식사 대전");
  return lines;
}

function asArray<T>(v: unknown): T[] | undefined {
  return Array.isArray(v) ? (v as T[]) : undefined;
}

/**
 * JSON 백업 → AppState.
 * `fullReplace` true면 defaultState 위에 덮어써 리셋된 서버를 오전 백업으로 되돌림.
 */
export function buildAppStateFromRestoreJson(
  patch: Record<string, unknown>,
  opts?: { base?: AppState; fullReplace?: boolean }
): AppState {
  const base = opts?.fullReplace ? defaultState() : opts?.base || defaultState();
  const members =
    asArray<Member>(patch.members)?.length ? (asArray<Member>(patch.members) as Member[]) : base.members;
  const validMemberIds = new Set(members.map((m) => m.id));

  const next: AppState = {
    ...base,
    ...(asArray<Member>(patch.members)?.length ? { members } : {}),
    ...(asArray(patch.donors) ? { donors: normalizeDonorsArray(patch.donors as AppState["donors"]) } : {}),
    ...(asArray(patch.sigInventory)?.length
      ? { sigInventory: normalizeSigInventory(patch.sigInventory as unknown[]) }
      : {}),
    ...(patch.memberPositions != null
      ? { memberPositions: normalizeMemberPositions(patch.memberPositions as AppState["memberPositions"], members) }
      : {}),
    ...(typeof patch.memberPositionMode === "string"
      ? { memberPositionMode: patch.memberPositionMode as AppState["memberPositionMode"] }
      : {}),
    ...(asArray<string>(patch.rankPositionLabels)
      ? { rankPositionLabels: patch.rankPositionLabels as string[] }
      : {}),
    ...(patch.donorRankingsTheme && typeof patch.donorRankingsTheme === "object"
      ? { donorRankingsTheme: { ...base.donorRankingsTheme, ...patch.donorRankingsTheme } as AppState["donorRankingsTheme"] }
      : {}),
    ...(patch.donorRankingsFullTheme && typeof patch.donorRankingsFullTheme === "object"
      ? {
          donorRankingsFullTheme: {
            ...base.donorRankingsFullTheme,
            ...patch.donorRankingsFullTheme,
          } as AppState["donorRankingsFullTheme"],
        }
      : {}),
    ...(asArray(patch.donorRankingsPresets)
      ? { donorRankingsPresets: patch.donorRankingsPresets as AppState["donorRankingsPresets"] }
      : {}),
    ...(typeof patch.donorRankingsPresetId === "string"
      ? { donorRankingsPresetId: patch.donorRankingsPresetId }
      : {}),
    ...(typeof patch.donorsFormat === "string"
      ? { donorsFormat: normalizeDonorsFormat(patch.donorsFormat, base.donorsFormat || "full") }
      : {}),
    ...(asArray(patch.contributionLogs)
      ? { contributionLogs: patch.contributionLogs as AppState["contributionLogs"] }
      : {}),
    ...(asArray<string>(patch.forbiddenWords) ? { forbiddenWords: patch.forbiddenWords as string[] } : {}),
    ...(asArray(patch.missions)
      ? { missions: ensureMissionItems(patch.missions as unknown[]) }
      : {}),
    ...(typeof patch.sigSoldOutStampUrl === "string"
      ? { sigSoldOutStampUrl: patch.sigSoldOutStampUrl }
      : {}),
    ...(patch.sigSalesMemberPresets && typeof patch.sigSalesMemberPresets === "object"
      ? { sigSalesMemberPresets: patch.sigSalesMemberPresets as AppState["sigSalesMemberPresets"] }
      : {}),
    ...(asArray<string>(patch.sigSalesExcludedIds)
      ? { sigSalesExcludedIds: patch.sigSalesExcludedIds as string[] }
      : {}),
    ...(patch.rouletteState != null ? { rouletteState: normalizeRouletteState(patch.rouletteState) } : {}),
    ...(asArray(patch.overlayPresets) ? { overlayPresets: patch.overlayPresets as AppState["overlayPresets"] } : {}),
    ...(patch.overlaySettings && typeof patch.overlaySettings === "object"
      ? { overlaySettings: patch.overlaySettings as AppState["overlaySettings"] }
      : {}),
    ...(patch.sigMatch && typeof patch.sigMatch === "object"
      ? { sigMatch: patch.sigMatch as AppState["sigMatch"] }
      : {}),
    ...(patch.sigMatchSettings && typeof patch.sigMatchSettings === "object"
      ? {
          sigMatchSettings: {
            ...base.sigMatchSettings,
            ...patch.sigMatchSettings,
            sigMatchPools: normalizeSigMatchPools(
              (patch.sigMatchSettings as AppState["sigMatchSettings"]).sigMatchPools,
              validMemberIds
            ),
            participantMemberIds: normalizeSigMatchParticipantIds(
              (patch.sigMatchSettings as AppState["sigMatchSettings"]).participantMemberIds,
              validMemberIds
            ),
          },
        }
      : {}),
    ...(patch.mealBattle && typeof patch.mealBattle === "object"
      ? { mealBattle: patch.mealBattle as AppState["mealBattle"] }
      : {}),
    ...(patch.mealMatch && typeof patch.mealMatch === "object"
      ? { mealMatch: patch.mealMatch as AppState["mealMatch"] }
      : {}),
    ...(patch.mealMatchSettings && typeof patch.mealMatchSettings === "object"
      ? { mealMatchSettings: patch.mealMatchSettings as AppState["mealMatchSettings"] }
      : {}),
    ...(patch.generalTimer && typeof patch.generalTimer === "object"
      ? { generalTimer: patch.generalTimer as AppState["generalTimer"] }
      : {}),
    ...(patch.matchTimerEnabled && typeof patch.matchTimerEnabled === "object"
      ? {
          matchTimerEnabled: {
            ...base.matchTimerEnabled,
            ...(patch.matchTimerEnabled as AppState["matchTimerEnabled"]),
          },
        }
      : {}),
    ...(patch.timerDisplayStyles && typeof patch.timerDisplayStyles === "object"
      ? { timerDisplayStyles: { ...base.timerDisplayStyles, ...patch.timerDisplayStyles } as AppState["timerDisplayStyles"] }
      : {}),
    ...(patch.donorRankingsOverlayConfig
      ? {
          donorRankingsOverlayConfig: normalizeDonorRankingsOverlayConfig(
            patch.donorRankingsOverlayConfig as AppState["donorRankingsOverlayConfig"]
          ),
        }
      : {}),
    ...(patch.donorRankingsFullOverlayConfig
      ? {
          donorRankingsFullOverlayConfig: normalizeDonorRankingsOverlayConfig(
            patch.donorRankingsFullOverlayConfig as AppState["donorRankingsFullOverlayConfig"]
          ),
        }
      : {}),
    ...(patch.donationListsOverlayConfig
      ? {
          donationListsOverlayConfig: normalizeDonationListsOverlayConfig(
            patch.donationListsOverlayConfig as AppState["donationListsOverlayConfig"]
          ),
        }
      : {}),
    ...(typeof patch.donationSyncMode === "string"
      ? { donationSyncMode: patch.donationSyncMode as AppState["donationSyncMode"] }
      : {}),
    ...(patch.sigRolling != null ? { sigRolling: normalizeSigRolling(patch.sigRolling) } : {}),
    ...(patch.sigRollingMeta && typeof patch.sigRollingMeta === "object"
      ? { sigRollingMeta: patch.sigRollingMeta as AppState["sigRollingMeta"] }
      : {}),
    updatedAt: Date.now(),
  };

  return next;
}

/** 오늘(또는 지정일) 일일 로그 → 없으면 전체 최신 */
export function pickDailyLogEntryForRestore(
  log: Record<string, DailyLogEntry[] | unknown[]> | null | undefined,
  preferDateKey?: string
): DailyLogEntry | null {
  if (!log || typeof log !== "object") return null;

  const tryDate = (dateKey: string): DailyLogEntry | null => {
    const entries = log[dateKey];
    if (!Array.isArray(entries) || entries.length === 0) return null;
    let best: DailyLogEntry | null = null;
    let bestTs = 0;
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as DailyLogEntry;
      const ts = Date.parse(String(e.at || ""));
      if (!Number.isFinite(ts) || ts <= bestTs) continue;
      bestTs = ts;
      best = e;
    }
    return best;
  };

  const today = preferDateKey || new Date().toISOString().slice(0, 10);
  const todayEntry = tryDate(today);
  if (todayEntry) return todayEntry;

  let best: DailyLogEntry | null = null;
  let bestTs = 0;
  for (const entries of Object.values(log)) {
    if (!Array.isArray(entries)) continue;
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as DailyLogEntry;
      const ts = Date.parse(String(e.at || ""));
      if (!Number.isFinite(ts) || ts <= bestTs) continue;
      if (!Array.isArray(e.donors) && !Array.isArray(e.members)) continue;
      bestTs = ts;
      best = e;
    }
  }
  return best;
}
