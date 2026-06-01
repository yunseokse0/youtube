import type { AppState } from "@/types";
import { buildRouletteIdlePreserveSettings } from "@/lib/state";
import { MANUAL_SIG_DRAFT_STATE_KEY, type ManualSigDraftPersist } from "@/lib/manual-sig-workbench";

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
  return {
    updatedAt: now,
    rouletteState: {
      ...idleRs,
      overlayReloadNonce: Number(base.rouletteState?.overlayReloadNonce || 0) + 1,
    },
    overlaySettings: draft
      ? { ...os, [MANUAL_SIG_DRAFT_STATE_KEY]: draft }
      : os,
  };
}
