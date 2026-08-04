import type { AppState } from "@/types";

/** Redis vs 인메모리 — 후원 직후 Redis 반영 지연 시 최신 스냅샷 선택 */
export function appStateFreshnessScore(state: AppState | null | undefined): number {
  if (!state || !Array.isArray(state.members)) return -1;
  const updatedAt = Number(state.updatedAt || 0);
  const donorRev = Number(state.donorRankingsUpdatedAt || 0);
  const donorsLen = Array.isArray(state.donors) ? state.donors.length : 0;
  return Math.max(updatedAt, donorRev) * 1_000 + Math.min(donorsLen, 999);
}

/**
 * 투네 자동 반영 직후 메모리는 최신인데 Redis GET이 한 박자 늦을 수 있음.
 * updatedAt·donorRankingsUpdatedAt·donors 길이로 더 신선한 쪽을 고른다.
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
  return scoreB > scoreA ? (b as AppState) : (a as AppState);
}
