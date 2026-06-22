import type { AppState } from "@/types";
import {
  buildManualSigBroadcastIdleResetPatch,
  mergeManualSigBroadcastIntoOverlaySettings,
} from "@/lib/manual-sig-broadcast-state";
import {
  emptyManualDrafts,
  emptyManualSoldFlags,
  MANUAL_SIG_DRAFT_STATE_KEY,
  readManualSigPickCountFromOverlaySettings,
  type ManualSigDraftPersist,
} from "@/lib/manual-sig-workbench";

/** 수동 OBS·관리자 — 회차 로그 없이 동일 세션으로만 방송 상태 유지 (레거시 식별용) */
export const MANUAL_OVERLAY_SESSION_ID = "manual_live";

export function isManualOverlaySessionId(sessionId: string | null | undefined): boolean {
  const sid = String(sessionId || "").trim();
  return sid === MANUAL_OVERLAY_SESSION_ID || sid.startsWith("manual_");
}

/** Redis·판매 이력에 남기지 않음(회전판 session_* 만 기록) */
export function shouldPersistRouletteHistoryLog(sessionId: string | null | undefined): boolean {
  return !isManualOverlaySessionId(sessionId);
}

/** 수동 판매 라운드만 IDLE — 회전판 `rouletteState`는 건드리지 않음 */
export function buildManualRoundResetPatch(base: AppState): Partial<AppState> {
  const now = Date.now();
  const os =
    base.overlaySettings && typeof base.overlaySettings === "object"
      ? { ...(base.overlaySettings as Record<string, unknown>) }
      : {};
  const pickCount = readManualSigPickCountFromOverlaySettings(os);
  const raw = os[MANUAL_SIG_DRAFT_STATE_KEY];
  let draft: ManualSigDraftPersist | undefined;
  if (raw && typeof raw === "object") {
    const d = raw as ManualSigDraftPersist;
    const { appliedSessionId: _drop, ...rest } = d as ManualSigDraftPersist & {
      appliedSessionId?: string;
    };
    draft = {
      ...rest,
      drafts: emptyManualDrafts(pickCount),
      oneShotPriceInput: "",
      sigSoldFlags: emptyManualSoldFlags(pickCount),
      oneShotMarkSold: false,
    };
  }
  const broadcast = buildManualSigBroadcastIdleResetPatch(base);
  return {
    updatedAt: now,
    overlaySettings: mergeManualSigBroadcastIntoOverlaySettings(
      {
        ...base,
        overlaySettings: draft
          ? ({ ...os, [MANUAL_SIG_DRAFT_STATE_KEY]: draft } as AppState["overlaySettings"])
          : (os as AppState["overlaySettings"]),
      },
      broadcast
    ),
  };
}
