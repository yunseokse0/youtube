import { normalizeDonorsArray, totalCombined } from "@/lib/state";
import type { AppState } from "@/types";

export type SettlementResetPersistFailReason =
  | "reload_missing"
  | "donors_remain"
  | "totals_remain"
  | "stamp_not_advanced";

export type SettlementResetPersistCheck = {
  ok: boolean;
  reason?: SettlementResetPersistFailReason;
  donorsCount: number;
  total: number;
  settlementResetAt: number;
};

/**
 * 정산 리셋 저장 후 KV 재조회로 stamp 상승·빈 후원·금액 0을 확인한다.
 * (가짜 ok로 클라만 비우고 서버에 옛 후원이 남는 사고 방지)
 */
export function verifySettlementResetPersisted(opts: {
  /** 리셋 직전 stamp */
  beforeResetAt: number;
  /** applySettlementResetToState 에 넣은 resetAt */
  expectedResetAt: number;
  reloaded: AppState | null | undefined;
}): SettlementResetPersistCheck {
  const before = Math.max(0, Math.floor(Number(opts.beforeResetAt) || 0));
  const expected = Math.max(0, Math.floor(Number(opts.expectedResetAt) || 0));
  const reloaded = opts.reloaded;
  if (!reloaded) {
    return {
      ok: false,
      reason: "reload_missing",
      donorsCount: -1,
      total: -1,
      settlementResetAt: 0,
    };
  }
  const donorsCount = normalizeDonorsArray(reloaded.donors).length;
  const total = totalCombined(reloaded);
  const settlementResetAt = Math.max(0, Math.floor(Number(reloaded.settlementResetAt) || 0));
  if (donorsCount > 0) {
    return { ok: false, reason: "donors_remain", donorsCount, total, settlementResetAt };
  }
  if (total > 0) {
    return { ok: false, reason: "totals_remain", donorsCount, total, settlementResetAt };
  }
  if (settlementResetAt < expected || settlementResetAt <= before) {
    return { ok: false, reason: "stamp_not_advanced", donorsCount, total, settlementResetAt };
  }
  return { ok: true, donorsCount, total, settlementResetAt };
}

/** 저장 직후 반환 state가 아직 비워지지 않았는지 */
export function settlementResetSavedStateStillDirty(state: AppState | null | undefined): boolean {
  if (!state) return true;
  return normalizeDonorsArray(state.donors).length > 0 || totalCombined(state) > 0;
}
