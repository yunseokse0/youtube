import type { AppState } from "@/types";
import {
  STATE_PICK_OBS_TEXT,
  STATE_PICK_OVERLAY,
  STATE_PICK_OVERLAY_DONORS,
  type StateApiPick,
} from "@/lib/state-api-pick";
import { readObsTextRegistryFromState } from "@/lib/obs-text-overlay";

/** 서버가 잠깐 빈 스냅샷을 주어도 직전 표시를 유지(멤버·목표 초기화 방지) */
export const OVERLAY_EMPTY_SNAPSHOT_GRACE_MS = 60_000;

export function overlayLastGoodStorageKey(
  userId?: string,
  pick: StateApiPick = STATE_PICK_OVERLAY
): string {
  return `overlay-last-good:${userId || "default"}:${pick}`;
}

function presetShowsDonationGoal(p: Record<string, unknown>): boolean {
  const goalValue = Number(p.goal || 0);
  return Boolean(p.showGoal) || (Number.isFinite(goalValue) && goalValue > 0);
}

/** pick별로 “방송에 쓸 만한” 스냅샷인지 */
export function isOverlayStateViable(state: AppState | null, pick: StateApiPick): boolean {
  if (!state) return false;
  if (pick === STATE_PICK_OBS_TEXT) {
    const reg = readObsTextRegistryFromState(state);
    return reg.instances.some((inst) =>
      inst.config.blocks.some(
        (b) =>
          b.visible !== false &&
          b.segments.some((s) => String(s.text ?? "").trim().length > 0)
      )
    );
  }
  if (pick === STATE_PICK_OVERLAY || pick === STATE_PICK_OVERLAY_DONORS) {
    if (Array.isArray(state.members) && state.members.length > 0) return true;
    const presets = state.overlayPresets;
    if (Array.isArray(presets)) {
      return presets.some((raw) => {
        if (!raw || typeof raw !== "object") return false;
        return presetShowsDonationGoal(raw as Record<string, unknown>);
      });
    }
    return false;
  }
  return true;
}

export function loadOverlayLastGood(
  userId?: string,
  pick: StateApiPick = STATE_PICK_OVERLAY
): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(overlayLastGoodStorageKey(userId, pick));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveOverlayLastGood(
  state: AppState,
  userId?: string,
  pick: StateApiPick = STATE_PICK_OVERLAY
): void {
  if (typeof window === "undefined") return;
  if (!isOverlayStateViable(state, pick)) return;
  try {
    window.localStorage.setItem(
      overlayLastGoodStorageKey(userId, pick),
      JSON.stringify(state)
    );
  } catch {
    /* quota / private mode */
  }
}

/** 멤버가 비었는데 방금 저장된 빈 응답이면 무시 */
export function shouldDiscardEmptyMembersSnapshot(
  incoming: AppState,
  pick: StateApiPick,
  lastGood: AppState | null
): boolean {
  if (pick !== STATE_PICK_OVERLAY && pick !== STATE_PICK_OVERLAY_DONORS) return false;
  if (!lastGood || !isOverlayStateViable(lastGood, pick)) return false;
  const emptyMembers = !Array.isArray(incoming.members) || incoming.members.length === 0;
  if (!emptyMembers) return false;
  const ts = incoming.updatedAt || Date.now();
  return Date.now() - ts <= OVERLAY_EMPTY_SNAPSHOT_GRACE_MS;
}

/** 서버/네트워크가 빈·무효 스냅샷을 주면 직전 last-good 유지 */
export function shouldKeepLastGoodInsteadOf(
  incoming: AppState | null | undefined,
  pick: StateApiPick,
  lastGood: AppState | null
): boolean {
  if (!lastGood || !isOverlayStateViable(lastGood, pick)) return false;
  if (!incoming) return true;
  if (!isOverlayStateViable(incoming, pick)) return true;
  if (shouldDiscardEmptyMembersSnapshot(incoming, pick, lastGood)) return true;
  return false;
}
