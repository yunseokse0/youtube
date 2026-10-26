import {
  isEmptyBroadcastDonationSession,
  normalizeDonorsArray,
} from "@/lib/state";
import type { AppState } from "@/types";

/**
 * 의도적 정산 리셋(멤버 유지·초기화)으로 후원을 비운 직후 세션 마커.
 * - settlementResetAt: 영구 필터 임계값 (리셋 이후에도 유지)
 * - intentionalDonationClearAt: “지금은 의도적으로 비어 있음” (첫 실후원 반영 시 해제)
 *
 * 사고성 플레이스홀더 비움에는 이 마커가 없으므로 백업·일일로그 heal 이 그대로 동작한다.
 */
export function isIntentionalDonationClearActive(
  state: Pick<AppState, "intentionalDonationClearAt" | "donors" | "members"> | null | undefined
): boolean {
  if (!state) return false;
  const clearAt = Number(state.intentionalDonationClearAt || 0);
  if (clearAt <= 0) return false;
  /** donors 가 비어 있으면 멤버 합계만 남은 orphan 이어도 의도적 비움으로 본다.
   *  (totalCombined>0 이면 empty-session 가드가 풀려 일일로그/백업이 되살리던 구멍) */
  if (normalizeDonorsArray(state.donors).length > 0) return false;
  return true;
}

/** 자동 복구(백업·일일로그·orphan heal) 억제 — 의도적 비움 세션 */
export function shouldSuppressAutoRosterRestore(
  state:
    | Pick<AppState, "intentionalDonationClearAt" | "donors" | "members" | "settlementResetAt">
    | null
    | undefined
): boolean {
  if (isIntentionalDonationClearActive(state)) return true;
  /** 리셋 stamp 이후 donors 비어 있으면 orphan 합계와 무관하게 자동 복구 금지 */
  const resetAt = Number(state?.settlementResetAt || 0);
  if (resetAt > 0 && normalizeDonorsArray(state?.donors).length === 0) return true;
  return false;
}

export function withIntentionalDonationClear(state: AppState, clearAt: number): AppState {
  const at = Number(clearAt || 0) || Date.now();
  return {
    ...state,
    intentionalDonationClearAt: at,
    settlementResetAt: Math.max(Number(state.settlementResetAt || 0), at),
  };
}

/**
 * 단건·전체 삭제 등 의도적 비움 — settlementResetAt 은 건드리지 않음.
 * (정산 리셋용 withIntentionalDonationClear 와 구분)
 */
export function markIntentionalDonationEmptySession(state: AppState): AppState {
  if (!isEmptyBroadcastDonationSession(state)) return state;
  if (Number(state.intentionalDonationClearAt || 0) > 0) return state;
  return { ...state, intentionalDonationClearAt: Date.now() };
}

/** 실후원( donors 행)이 들어오면 의도적 비움 마커 해제 (리셋 stamp 자체는 유지).
 *  멤버 합계만 남은 orphan 으로는 마커를 풀지 않는다. */
export function clearIntentionalDonationClearIfHasDonations(state: AppState): AppState {
  if (!Number(state.intentionalDonationClearAt || 0)) return state;
  if (normalizeDonorsArray(state.donors).length === 0) {
    return state;
  }
  const next = { ...state };
  delete next.intentionalDonationClearAt;
  return next;
}

/**
 * settlementReset 플래그 없이 클라이언트가 intentionalDonationClearAt 을
 * 올리거나 유지하지 못하게 — 서버 base 값만 보존.
 */
export function coalesceIntentionalDonationClearAt(opts: {
  baseClearAt?: number;
  patchClearAt?: number;
  settlementReset?: boolean;
  resetStamp?: number;
  hasDonations?: boolean;
}): number | undefined {
  if (opts.hasDonations) return undefined;
  if (opts.settlementReset) {
    const stamp = Number(opts.resetStamp || opts.patchClearAt || 0);
    return stamp > 0 ? stamp : Date.now();
  }
  const base = Number(opts.baseClearAt || 0);
  return base > 0 ? base : undefined;
}
