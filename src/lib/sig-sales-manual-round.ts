import type { AppState } from "@/types";
import { buildRouletteIdlePreserveSettings } from "@/lib/state";
import { MANUAL_SIG_DRAFT_STATE_KEY, type ManualSigDraftPersist } from "@/lib/manual-sig-workbench";

/** 수동 OBS·관리자 — 회차 로그 없이 동일 세션으로만 방송 상태 유지 */
export const MANUAL_OVERLAY_SESSION_ID = "manual_live";

export function isManualOverlaySessionId(sessionId: string | null | undefined): boolean {
  const sid = String(sessionId || "").trim();
  return sid === MANUAL_OVERLAY_SESSION_ID || sid.startsWith("manual_");
}

/** Redis·판매 이력에 남기지 않음(회전판 session_* 만 기록) */
export function shouldPersistRouletteHistoryLog(sessionId: string | null | undefined): boolean {
  return !isManualOverlaySessionId(sessionId);
}

/** 수동 판매 라운드만 IDLE — 회전판 당첨 제외 목록은 유지 */
export function buildManualRoundResetPatch(base: AppState): Partial<AppState> {
  const now = Date.now();
  const idleRs = buildRouletteIdlePreserveSettings(base.rouletteState, {
    clearSessionExcluded: false,
  });
  const os =
    base.overlaySettings && typeof base.overlaySettings === "object"
      ? { ...(base.overlaySettings as Record<string, unknown>) }
      : {};
  const raw = os[MANUAL_SIG_DRAFT_STATE_KEY];
  let draft: ManualSigDraftPersist | undefined;
  if (raw && typeof raw === "object") {
    const d = raw as ManualSigDraftPersist;
    const { appliedSessionId: _drop, ...rest } = d as ManualSigDraftPersist & {
      appliedSessionId?: string;
    };
    draft = {
      ...rest,
      sigSoldFlags: [false, false, false, false, false],
      oneShotMarkSold: false,
    };
  }
  const overlayReloadNonce = Number(base.rouletteState?.overlayReloadNonce || 0) + 1;
  return {
    updatedAt: now,
    rouletteState: {
      ...idleRs,
      sessionId: MANUAL_OVERLAY_SESSION_ID,
      startedAt: now,
      overlayReloadNonce,
      selectedSigs: undefined,
      results: undefined,
      result: null,
      oneShotResult: null,
    },
    overlaySettings: draft
      ? { ...os, [MANUAL_SIG_DRAFT_STATE_KEY]: draft }
      : os,
  };
}
