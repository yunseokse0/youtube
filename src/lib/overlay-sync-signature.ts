import type { AppState } from "@/types";

/**
 * 오버레이 `useRemoteState`가 GET/SSE로 받은 스냅샷을 적용할지 판단하는 서명.
 * 멤버·후원만 넣으면 타이머 스타일·미션·랭킹 UI 등 옵션 변경이 실시간 반영되지 않는다.
 */
export function buildOverlaySyncSignature(state: AppState | null): string {
  if (!state) return "";

  const members = (state.members || [])
    .map((m) => ({
      id: m.id,
      name: m.name,
      account: m.account || 0,
      toon: m.toon || 0,
      operating: Boolean(m.operating),
    }))
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

  const donors = (state.donors || [])
    .map((d) => ({
      id: d.id,
      name: d.name,
      amount: d.amount || 0,
      target: d.target || "",
      at: d.at || 0,
    }))
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

  const generalTimer = state.generalTimer
    ? {
        remainingTime: state.generalTimer.remainingTime,
        isActive: state.generalTimer.isActive,
        lastUpdated: state.generalTimer.lastUpdated,
      }
    : null;

  return JSON.stringify({
    members,
    donors,
    memberPositions: state.memberPositions || {},
    rankPositionLabels: state.rankPositionLabels || [],
    generalTimer,
    matchTimerEnabled: state.matchTimerEnabled || {},
    timerDisplayStyles: state.timerDisplayStyles || {},
    overlaySettings: state.overlaySettings || {},
    overlayPresets: state.overlayPresets || [],
    missions: state.missions || [],
    donorRankingsOverlayConfig: state.donorRankingsOverlayConfig || {},
    donationListsOverlayConfig: state.donationListsOverlayConfig || {},
    mealBattle: state.mealBattle || {},
    sigMatchSettings: state.sigMatchSettings || {},
    sigMatch: state.sigMatch || {},
  });
}
