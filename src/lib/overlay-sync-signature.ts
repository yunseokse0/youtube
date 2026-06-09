import type { AppState } from "@/types";
import { readManualSigBroadcastFromState } from "@/lib/manual-sig-broadcast-state";
import { canonicalSigIdFromWheelSliceId } from "@/lib/sig-roulette";

const MANUAL_SIG_DRAFT_STATE_KEY = "sigSalesManualDraftV1";

/** 시그 판매 OBS — 동일 스냅샷이면 setState·HYDRATE 생략(수동 결과 GIF 깜빡임 방지) */
export function buildSigSalesOverlaySyncSignature(state: AppState | null): string {
  if (!state) return "";
  const os = state.overlaySettings;
  const draft =
    os && typeof os === "object"
      ? (os as Record<string, unknown>)[MANUAL_SIG_DRAFT_STATE_KEY]
      : null;
  const flags =
    draft && typeof draft === "object" && Array.isArray((draft as { sigSoldFlags?: unknown }).sigSoldFlags)
      ? ((draft as { sigSoldFlags: boolean[] }).sigSoldFlags || [])
      : [];
  const draftRows =
    draft && typeof draft === "object" && Array.isArray((draft as { drafts?: unknown }).drafts)
      ? ((draft as { drafts?: Array<{ name?: string; priceInput?: string; imageUrl?: string }> }).drafts || [])
      : [];
  const inv = (state.sigInventory || [])
    .map((r) => ({
      id: canonicalSigIdFromWheelSliceId(r.id),
      sc: Math.floor(Number(r.soldCount || 0)),
      mc: Math.floor(Number(r.maxCount || 1)),
      n: String(r.name || ""),
      p: Math.floor(Number(r.price || 0)),
      iu: String(r.imageUrl || ""),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const broadcast = readManualSigBroadcastFromState(state);
  const selected = broadcast?.selectedSigs || [];
  return JSON.stringify({
    u: state.updatedAt || 0,
    inv,
    flags,
    oneShot: Boolean(
      draft && typeof draft === "object" && (draft as { oneShotMarkSold?: boolean }).oneShotMarkSold
    ),
    /** 수동 한방·행 이미지 URL — 없으면 OBS가 이전 스냅샷을 유지해 한방 GIF가 안 바뀜 */
    osi:
      draft && typeof draft === "object"
        ? String((draft as { oneShotImageUrl?: unknown }).oneShotImageUrl || "").trim()
        : "",
    draftImg: draftRows.map((r) => String(r?.imageUrl || "").trim()).join("\u001f"),
    phase: broadcast?.phase || "",
    nonce: Number(broadcast?.overlayReloadNonce || 0),
    sel: selected.map((s) => canonicalSigIdFromWheelSliceId(s.id)),
    /** selectedSigs.imageUrl — 리롤 후 URL만 바뀌어도 OBS가 갱신되게 */
    selImg: selected.map((s) => String(s.imageUrl || "").trim()).join("\u001f"),
    stamp: state.sigSoldOutStampUrl || "",
  });
}

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
      contribution: m.contribution || 0,
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
    donorRankingsFullTheme: state.donorRankingsFullTheme || {},
    donorRankingsFullOverlayConfig: state.donorRankingsFullOverlayConfig || {},
    donationListsOverlayConfig: state.donationListsOverlayConfig || {},
    mealBattle: state.mealBattle || {},
    sigMatchSettings: state.sigMatchSettings || {},
    sigMatch: state.sigMatch || {},
  });
}
