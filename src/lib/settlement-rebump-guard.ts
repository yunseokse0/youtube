import { normalizeDonorsArray } from "@/lib/state";
import type { AppState } from "@/types";

/** rebump 는 at = 리셋 시각 + 순번(ms) 으로 찍는다 — 리셋 직후 이 구간의 미지 행은 되살린 구 후원으로 본다. */
export const REBUMP_SIGNATURE_WINDOW_MS = 1_000;

/**
 * 브라우저 후원 저장(`/api/donations/persist`)에서 서버에 없는 행 중
 * at 이 정산 리셋 직후 rebump 구간에 있는 행을 뺀다.
 * 사용자가 명시한 일일 로그 복구는 호출하지 않는다.
 */
export function dropRebumpedPreResetDonors(
  incoming: AppState,
  server: AppState | null | undefined
): { state: AppState; dropped: number } {
  const resetAt = Number(server?.settlementResetAt || 0);
  if (!server || !(resetAt > 0)) return { state: incoming, dropped: 0 };
  const donors = normalizeDonorsArray(incoming.donors);
  const known = new Set(normalizeDonorsArray(server.donors).map((d) => String(d.id)));
  const windowEnd = resetAt + donors.length + REBUMP_SIGNATURE_WINDOW_MS;
  const kept = donors.filter((d) => {
    if (known.has(String(d.id))) return true;
    const at = Number(d.at);
    return !(Number.isFinite(at) && at >= resetAt && at < windowEnd);
  });
  const dropped = donors.length - kept.length;
  if (dropped === 0) return { state: incoming, dropped: 0 };
  return { state: { ...incoming, donors: kept }, dropped };
}
