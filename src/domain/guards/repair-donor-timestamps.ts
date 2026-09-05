import type { Donor } from "@/types";
import { parseDonorAtMsFromDonorId } from "@/lib/donation/toonation/parse-event";

export type DailyLogDonorSnapshot = {
  at: string;
  donors: Donor[];
};

function donorAtEpochMs(donor: { at?: number | string }): number {
  const raw = donor.at;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (Number.isFinite(Number(raw))) return Math.floor(Number(raw));
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 동일 초에 N건 이상이면 일괄 반영(배치) 시각으로 간주 */
export function detectSuspectBatchStampSeconds(
  donors: Array<{ at?: number | string }>,
  minClusterSize = 5
): Set<number> {
  const bySecond = new Map<number, number>();
  for (const d of donors) {
    const at = donorAtEpochMs(d);
    if (!Number.isFinite(at) || at <= 0) continue;
    const sec = Math.floor(at / 1000);
    bySecond.set(sec, (bySecond.get(sec) || 0) + 1);
  }
  return new Set(
    [...bySecond.entries()].filter(([, count]) => count >= minClusterSize).map(([sec]) => sec)
  );
}

function isSuspectBatchAt(atMs: number, suspectSeconds: Set<number>): boolean {
  if (!Number.isFinite(atMs) || atMs <= 0) return false;
  return suspectSeconds.has(Math.floor(atMs / 1000));
}

/** daily log 전체에서 donor id별 가장 이른 at */
export function buildDailyLogMinAtByDonorId(
  dailyLog?: Record<string, DailyLogDonorSnapshot[]>,
  beforeMs?: number
): Map<string, number> {
  const out = new Map<string, number>();
  if (!dailyLog) return out;
  for (const entries of Object.values(dailyLog)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const entryMs = new Date(entry.at).getTime();
      if (beforeMs != null && Number.isFinite(beforeMs) && entryMs > beforeMs) continue;
      for (const d of entry.donors || []) {
        const id = String(d.id || "").trim();
        if (!id) continue;
        const at = donorAtEpochMs(d);
        if (!Number.isFinite(at) || at <= 0) continue;
        const prev = out.get(id);
        if (prev == null || at < prev) out.set(id, at);
      }
    }
  }
  return out;
}

export type RepairDonorTimestampsOptions = {
  dailyLog?: Record<string, DailyLogDonorSnapshot[]>;
  /** 정산 스냅샷 복구용 — live 후원 목록 */
  referenceDonors?: Donor[];
  /** 정산 생성 시각 이전 daily log만 사용 */
  settlementCreatedAt?: number;
  minClusterSize?: number;
};

function pickBestDonorAtMs(
  stored: number,
  candidates: Array<{ at: number; priority: number }>,
  suspectSeconds: Set<number>
): number {
  const valid = candidates.filter((c) => Number.isFinite(c.at) && c.at > 0);
  if (valid.length === 0) return stored;

  valid.sort((a, b) => a.priority - b.priority || a.at - b.at);

  const nonSuspect = valid.filter((c) => !isSuspectBatchAt(c.at, suspectSeconds));
  if (nonSuspect.length > 0) return nonSuspect[0]!.at;

  /** 배치 시각만 남았으면 id·로그 등 우선순위 높은 후보 사용 */
  return valid[0]!.at;
}

/**
 * 일괄 반영·동기화로 동일 초에 찍힌 후원 시각 복구.
 * 우선순위: id embedded 시각 > daily log 최소 > reference(비배치) > stored(비배치)
 */
export function repairDonorTimestamps(donors: Donor[], opts?: RepairDonorTimestampsOptions): Donor[] {
  if (!donors.length) return donors;

  const allForCluster = [
    ...donors,
    ...(opts?.referenceDonors || []).filter((d) => String(d.id || "").trim()),
  ];
  const suspectSeconds = detectSuspectBatchStampSeconds(allForCluster, opts?.minClusterSize ?? 5);
  const logMinById = buildDailyLogMinAtByDonorId(opts?.dailyLog, opts?.settlementCreatedAt);
  const refById = new Map(
    (opts?.referenceDonors || [])
      .map((d) => [String(d.id || "").trim(), d] as const)
      .filter(([id]) => Boolean(id))
  );

  return donors.map((donor) => {
    const stored = donorAtEpochMs(donor);
    const id = String(donor.id || "").trim();
    const candidates: Array<{ at: number; priority: number }> = [];

    const fromId = parseDonorAtMsFromDonorId(donor.id, donor.amount);
    if (fromId != null) candidates.push({ at: fromId, priority: 1 });

    const ref = refById.get(id);
    if (ref) {
      const refAt = donorAtEpochMs(ref);
      if (Number.isFinite(refAt) && refAt > 0) {
        candidates.push({ at: refAt, priority: 2 });
      }
    }

    const logMin = logMinById.get(id);
    if (logMin != null) candidates.push({ at: logMin, priority: 3 });

    if (Number.isFinite(stored) && stored > 0) {
      candidates.push({ at: stored, priority: 4 });
    }

    const best = pickBestDonorAtMs(stored, candidates, suspectSeconds);
    return best === stored ? donor : { ...donor, at: best };
  });
}

export function donorTimestampsChanged(before: Donor[], after: Donor[]): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i += 1) {
    if (donorAtEpochMs(before[i]!) !== donorAtEpochMs(after[i]!)) return true;
  }
  return false;
}
