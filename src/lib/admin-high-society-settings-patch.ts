import type { AppState } from "@/lib/state";
import type { Donor } from "@/types";
import {
  buildTerritoryPauseToggleSettingsPatch,
  isHighSocietyReopen,
  mergeHighSocietyDonationLinksOnSettingsChange,
  normalizeHighSocietySettings,
  reconcileHighSocietyFieldDimensions,
  resolveDonationSyncModeForHighSocietySettingsChange,
  resolveDonorsForHighSocietySettingsPatch,
  resolveHighSocietySeatCountForField,
  resolveHighSocietySeatMembers,
  shouldApplyDonorsForHighSocietySettingsPatch,
  shouldMarkDonorsLocallyForHighSocietySettingsPatch,
  shouldPersistDonorsForHighSocietySettingsPatch,
  syncHighSocietyMemberWidthSnapshotInState,
  type HighSocietySettingsAdminPatch,
} from "@/lib/high-society";
import { guardMemberTotalsAgainstAccidentalZeroWipe } from "@/lib/donation/zero-wipe-guard";
import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import { normalizeDonorsArray } from "@/lib/state";

/** 관리자·팝업 공통 — 상류사회 설정 patch 를 AppState 에 반영 */
export function applyHighSocietyAdminPatchToState(
  prev: AppState,
  patch: HighSocietySettingsAdminPatch,
  opts?: { lsDonors?: Donor[] }
): AppState {
  const resetTerritory = Boolean(patch.resetTerritory);
  const { resetTerritory: _drop, ...settingsPatchRaw } = patch;
  const prevSettings = normalizeHighSocietySettings(prev.highSocietySettings);
  const prevForPause = prevSettings;
  let settingsPatch = { ...settingsPatchRaw };
  if (typeof patch.territoryPaused === "boolean") {
    settingsPatch = {
      ...settingsPatch,
      ...buildTerritoryPauseToggleSettingsPatch(patch, prevForPause),
    };
  }
  const wasOn = prevSettings.enabled;
  let nextSettings = normalizeHighSocietySettings({
    ...prevSettings,
    ...settingsPatch,
  });
  const turningOn = !wasOn && nextSettings.enabled;
  const turningOff = wasOn && !nextSettings.enabled;
  const isFirstOn = turningOn && !isHighSocietyReopen(prevSettings);
  nextSettings = mergeHighSocietyDonationLinksOnSettingsChange({
    prevSettings,
    nextSettings,
    members: prev.members || [],
    resetTerritory,
    donors: prev.donors || [],
  });
  const hsSeatPlayersForPersist = resolveHighSocietySeatMembers(prev.members || [], nextSettings);
  const hsSeatCountForPersist = resolveHighSocietySeatCountForField(
    nextSettings,
    hsSeatPlayersForPersist.length
  );
  nextSettings = reconcileHighSocietyFieldDimensions(
    nextSettings,
    hsSeatCountForPersist,
    prev.members || []
  );
  const needsDonorPersist = shouldPersistDonorsForHighSocietySettingsPatch({
    resetTerritory,
    isFirstOn,
  });
  const needsDonorLocalMark = shouldMarkDonorsLocallyForHighSocietySettingsPatch({
    resetTerritory,
    isFirstOn,
  });
  let donorsPatch: Donor[] | null = null;
  if (needsDonorLocalMark) {
    const resolvedDonors = resolveDonorsForHighSocietySettingsPatch({
      prevDonorsReact: prev.donors,
      refDonors: prev.donors,
      lsDonors: normalizeDonorsArray(opts?.lsDonors),
      resetTerritory,
      isFirstOn,
    });
    if (shouldApplyDonorsForHighSocietySettingsPatch(resolvedDonors)) {
      donorsPatch = resolvedDonors;
    }
  }
  const nextDonationSyncMode = resolveDonationSyncModeForHighSocietySettingsChange({
    turningOn,
    turningOff,
    prevMode: prev.donationSyncMode,
  });
  let next: AppState = {
    ...prev,
    ...(donorsPatch ? { donors: donorsPatch } : {}),
    highSocietySettings: nextSettings,
    donationSyncMode: nextDonationSyncMode,
    updatedAt: Date.now(),
  };
  if (needsDonorPersist && donorsPatch != null) {
    next = guardMemberTotalsAgainstAccidentalZeroWipe(syncMemberTotalsFromDonors(next), prev);
  }
  next = syncHighSocietyMemberWidthSnapshotInState(next);
  next = {
    ...next,
    highSocietySettings: normalizeHighSocietySettings(next.highSocietySettings),
  };
  return next;
}
