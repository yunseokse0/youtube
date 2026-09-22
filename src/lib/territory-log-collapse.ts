import type { TerritoryLog } from "@/types";

/** 더블클릭·중복 반영으로 같은 내용이 연속으로 들어간 것으로 보는 창 */
export const TERRITORY_LOG_NEAR_DUP_MS = 800;

export function territoryLogFingerprint(log: TerritoryLog): string {
  const who = String(log.teamId || "").trim() || String(log.memberId || "").trim();
  return `${who}|${log.delta}|${log.amount}|${log.pushDir || ""}|${String(log.note || "").trim()}`;
}

/** 같은 대상·cm·방향이 800ms 안에 두 번이면 앞선 한 건만 남긴다. */
export function collapseNearDuplicateTerritoryLogs(
  logs: TerritoryLog[] | undefined,
  windowMs = TERRITORY_LOG_NEAR_DUP_MS
): TerritoryLog[] {
  const all = Array.isArray(logs) ? logs : [];
  if (all.length < 2) return all;
  const sorted = [...all].sort(
    (a, b) => Number(a.at || 0) - Number(b.at || 0) || String(a.id).localeCompare(String(b.id))
  );
  const kept: TerritoryLog[] = [];
  for (const log of sorted) {
    const fp = territoryLogFingerprint(log);
    const at = Number(log.at || 0);
    const dup = kept.some(
      (prev) =>
        territoryLogFingerprint(prev) === fp && Math.abs(Number(prev.at || 0) - at) <= windowMs
    );
    if (dup) continue;
    kept.push(log);
  }
  const ids = new Set(kept.map((l) => String(l.id)));
  return all.filter((l) => ids.has(String(l.id)));
}

export function isNearDuplicateTerritoryLog(
  existing: TerritoryLog[] | undefined,
  incoming: TerritoryLog,
  windowMs = TERRITORY_LOG_NEAR_DUP_MS
): boolean {
  const fp = territoryLogFingerprint(incoming);
  const at = Number(incoming.at || 0);
  return (Array.isArray(existing) ? existing : []).some(
    (prev) =>
      territoryLogFingerprint(prev) === fp && Math.abs(Number(prev.at || 0) - at) <= windowMs
  );
}
