import type { AppState } from "@/types";

/**
 * 정산 리셋(후원·금액 초기화) 시에도 유지할 설정.
 * 제목·테마·오버레이 옵션 등은 사용자가 바꾸기 전까지 고정.
 */
export function pickSettingsPreservedAcrossSettlementReset(
  state: AppState
): Partial<AppState> {
  return {
    donorRankingsTheme: state.donorRankingsTheme,
    donorRankingsFullTheme: state.donorRankingsFullTheme,
    donorRankingsOverlayConfig: state.donorRankingsOverlayConfig,
    donorRankingsFullOverlayConfig: state.donorRankingsFullOverlayConfig,
    donorRankingsPresets: state.donorRankingsPresets,
    donorRankingsPresetId: state.donorRankingsPresetId,
    donationListsOverlayConfig: state.donationListsOverlayConfig,
    donorsFormat: state.donorsFormat,
    highSocietySettings: state.highSocietySettings,
    overlaySettings: state.overlaySettings,
    rankPositionLabels: state.rankPositionLabels,
    memberPositionMode: state.memberPositionMode,
    sigInventory: state.sigInventory,
    sigSoldOutStampUrl: state.sigSoldOutStampUrl,
    sigSalesMemberPresets: state.sigSalesMemberPresets,
    sigSalesExcludedIds: state.sigSalesExcludedIds,
    rouletteState: state.rouletteState,
    sigRolling: state.sigRolling,
    sigRollingMeta: state.sigRollingMeta,
    sigMatchSettings: state.sigMatchSettings,
    mealMatchSettings: state.mealMatchSettings,
    generalTimer: state.generalTimer,
    matchTimerEnabled: state.matchTimerEnabled,
    timerDisplayStyles: state.timerDisplayStyles,
    forbiddenWords: state.forbiddenWords,
    donationSyncMode: state.donationSyncMode,
    missions: state.missions || [],
  };
}
