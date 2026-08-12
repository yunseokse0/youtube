import type { AppState } from "@/types";
import {
  hasMeaningfulMemberRoster,
  isAccidentalEmptyRosterState,
  isIntentionalDonorListShrink,
  normalizeDonorsArray,
} from "@/lib/state";

/** Redis vs 인메모리 — 후원 직후 Redis 반영 지연 시 최신 스냅샷 선택 */
export function appStateFreshnessScore(state: AppState | null | undefined): number {
  if (!state || !Array.isArray(state.members)) return -1;
  const updatedAt = Number(state.updatedAt || 0);
  const donorRev = Number(state.donorRankingsUpdatedAt || 0);
  const donorsLen = Array.isArray(state.donors) ? state.donors.length : 0;
  return Math.max(updatedAt, donorRev) * 1_000 + Math.min(donorsLen, 999);
}

function memberAmountTotal(state: AppState): number {
  return (state.members || []).reduce(
    (sum, m) =>
      sum + Math.max(0, Math.floor(Number(m.account || 0))) + Math.max(0, Math.floor(Number(m.toon || 0))),
    0
  );
}

/**
 * 투네 자동 반영 직후 메모리는 최신인데 Redis GET이 한 박자 늦을 수 있음.
 * - settlementResetAt 이 더 높은 쪽이 정본(정산 리셋) — 단 사고성 플레이스홀더 빈 상태는 제외
 * - 같은 리셋 구간에서는 빈/축소 스냅샷이 실후원을 이기지 않음
 * - 그 외 updatedAt·donorRankingsUpdatedAt·donors 길이로 선택
 */
export function pickFresherAppState(
  a: AppState | null | undefined,
  b: AppState | null | undefined
): AppState | null {
  const scoreA = appStateFreshnessScore(a);
  const scoreB = appStateFreshnessScore(b);
  if (scoreA < 0 && scoreB < 0) return null;
  if (scoreA < 0) return b ?? null;
  if (scoreB < 0) return a ?? null;

  const stateA = a as AppState;
  const stateB = b as AppState;
  const resetA = Number(stateA.settlementResetAt || 0);
  const resetB = Number(stateB.settlementResetAt || 0);
  if (resetB > resetA) {
    if (isAccidentalEmptyRosterState(stateB) && !isAccidentalEmptyRosterState(stateA)) {
      return stateA;
    }
    return stateB;
  }
  if (resetA > resetB) {
    if (isAccidentalEmptyRosterState(stateA) && !isAccidentalEmptyRosterState(stateB)) {
      return stateB;
    }
    return stateA;
  }

  const donorsA = normalizeDonorsArray(stateA.donors);
  const donorsB = normalizeDonorsArray(stateB.donors);

  /** 같은 리셋 — 빈 쪽이 시각만 앞서도 실후원을 덮지 않음 */
  if (donorsA.length > 0 && donorsB.length === 0) return stateA;
  if (donorsB.length > 0 && donorsA.length === 0) return stateB;

  /** 엑셀 실멤버 vs 플레이스홀더 — 시각만 앞선 빈 슬롯이 이기지 않음 */
  const meaningfulA = hasMeaningfulMemberRoster(stateA);
  const meaningfulB = hasMeaningfulMemberRoster(stateB);
  if (meaningfulA && !meaningfulB) return stateA;
  if (meaningfulB && !meaningfulA) return stateB;

  const totalA = memberAmountTotal(stateA);
  const totalB = memberAmountTotal(stateB);
  if (totalA > 0 && totalB === 0) return stateA;
  if (totalB > 0 && totalA === 0) return stateB;

  if (donorsA.length !== donorsB.length) {
    const richer = donorsA.length > donorsB.length ? stateA : stateB;
    const poorer = donorsA.length > donorsB.length ? stateB : stateA;
    const poorerIsIntentionalShrink = isIntentionalDonorListShrink(
      normalizeDonorsArray(poorer.donors),
      normalizeDonorsArray(richer.donors),
      Number(poorer.updatedAt || 0),
      Number(richer.updatedAt || 0)
    );
    if (!poorerIsIntentionalShrink) {
      /** 투네 1건(신규 id)만 있는 축소본이 수동 다건을 이기지 않게 풍부한 쪽 유지 */
      const poorerOnlyNew =
        normalizeDonorsArray(poorer.donors).some(
          (d) => !normalizeDonorsArray(richer.donors).some((r) => r.id === d.id)
        ) && normalizeDonorsArray(poorer.donors).length < normalizeDonorsArray(richer.donors).length;
      if (poorerOnlyNew || donorsA.length === 0 || donorsB.length === 0) {
        return richer;
      }
    }
  }

  return scoreB > scoreA ? stateB : stateA;
}
