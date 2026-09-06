import type { Donor } from "@/types";
import {
  donorAtEpochMs,
  donorInferSourceKind,
  donorTargetField,
  isCrossDonationSourcePair,
  DONATION_NEAR_DUP_WINDOW_MS,
  isDonorExcludedFromDonationTotals as _excluded,
  isWeakToonationDonorId,
  isOwnerRemapSplitDuplicate,
  normalizeDonationEventId,
  normalizeDonorNameKey,
  shouldTreatAsDuplicateDonationContent,
} from "@/domain/dedupe/donation-dedupe.rules";
import {
  DONATION_IDENTICAL_MESSAGE_NEAR_DUP_MS,
  CROSS_SOURCE_NEAR_DUP_MS,
  BANK_RESEND_NEAR_DUP_MS,
} from "@/lib/donation/donation-dedupe-keys";
import {
  isDonationAmountEligibleForHighSocietyTerritory,
  isDonorHsTerritoryIncluded,
} from "@/lib/high-society";

const isDonorExcludedFromDonationTotals = _excluded;
export { isDonorExcludedFromDonationTotals };

type MergeableDonor = {
  id?: string;
  name?: string;
  amount?: number;
  at?: number | string;
  message?: string;
  target?: string;
  externalId?: string;
  rawHash?: string | number;
  groupSplit?: boolean;
  groupSplitSource?: boolean;
  memberId?: string;
  donationExcluded?: boolean;
  hsTerritoryExcluded?: boolean;
  hsPushDir?: "left" | "right" | "split";
  donorName?: string;
  provider?: string;
};

export function donorRowDedupeKey(donor: MergeableDonor): string {
  const rawId = String(donor.id || "").trim();
  const baseId = normalizeDonationEventId(rawId);
  const isSplitPart = Boolean(donor.groupSplit) || baseId.includes(":split:");
  const isSplitSource = Boolean(donor.groupSplitSource);
  if (isSplitPart) {
    const memberId = String(donor.memberId || "").trim() || "z";
    const amt = Math.max(0, Math.floor(Number(donor.amount || 0)));
    return `split:${baseId}|${memberId}|${amt}`;
  }
  if (isSplitSource) {
    return `src:${baseId}`;
  }
  const toonationMatch = /^toonation:(.+)$/i.exec(baseId);
  if (toonationMatch) {
    const ext = toonationMatch[1].toLowerCase();
    if (!isWeakToonationDonorId(rawId)) return `toonation:${ext}`;
    const rawExt = String(donor.externalId || "").trim();
    const seed = rawExt || String(donor.rawHash || "").trim();
    if (seed) {
      const seedHash = Math.abs(
        Array.from(seed).reduce(
          (acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0,
          0x9e3779b9
        )
      )
        .toString(36)
        .padStart(7, "0")
        .slice(-7);
      return `id:${baseId}#${seedHash}`;
    }
    return `id:${baseId}`;
  }
  if (baseId) return `id:${baseId}`;
  const name = String(donor.name || "").trim();
  const amount = Math.floor(Number(donor.amount || 0));
  const rawFallbackExt = String(donor.externalId || donor.rawHash || "").trim();
  if (rawFallbackExt) {
    const fallbackHash = Math.abs(
      Array.from(rawFallbackExt).reduce(
        (acc, ch) => (acc * 131 + ch.charCodeAt(0)) | 0,
        0xdeadbeef
      )
    )
      .toString(36)
      .padStart(6, "0")
      .slice(-5);
    return `fallback:${name}|${donorAtEpochMs(donor)}|${amount}|${fallbackHash}`;
  }
  const seedParts: string[] = [name, String(donorAtEpochMs(donor)), String(amount)];
  if (rawId) {
    seedParts.push(rawId);
  } else {
    const wholeObj = `${name}|${donorAtEpochMs(donor)}|${amount}|${String(donor.message || "")}`;
    seedParts.push(wholeObj);
  }
  const lastResortSeed = seedParts.join("||");
  const lastResortHash = Math.abs(
    Array.from(lastResortSeed).reduce(
      (acc, ch) => (acc * 257 + ch.charCodeAt(0)) | 0,
      0x9e3779b9
    )
  )
    .toString(36)
    .padStart(6, "0")
    .slice(-6);
  return `fallback:${name}|${donorAtEpochMs(donor)}|${amount}|${lastResortHash}`;
}

export function mergeDonorRowFields<T extends MergeableDonor>(
  preferred: T,
  fallback?: T | null
): T {
  if (!fallback) return preferred;
  const KIND_RELIABILITY: Record<string, number> = { toonation: 10, other: 5, bank: 1 };
  const kindPref = donorInferSourceKind(preferred);
  const kindFall = donorInferSourceKind(fallback);
  const relPref = KIND_RELIABILITY[kindPref] || 0;
  const relFall = KIND_RELIABILITY[kindFall] || 0;
  const usePrefForMeta =
    relPref > relFall
      ? true
      : relFall > relPref
        ? false
        : String(preferred.name || preferred.donorName || "").length >=
          String(fallback.name || fallback.donorName || "").length;
  const bestNameSrc: T = usePrefForMeta ? preferred : fallback;
  const bestTargetSrc: T = usePrefForMeta ? preferred : fallback;
  const mergedName =
    String(
      bestNameSrc.name ||
        bestNameSrc.donorName ||
        preferred.name ||
        preferred.donorName ||
        fallback.name ||
        fallback.donorName ||
        ""
    ).trim() || undefined;
  const rawPrefTarget = String(preferred.target || "").trim();
  const rawFallTarget = String(fallback.target || "").trim();
  const targetPref = rawPrefTarget || bestTargetSrc.target;
  const mergedTarget = targetPref ? String(targetPref).trim() : rawFallTarget || undefined;

  const msg = String(preferred.message || "").trim();
  const fallbackMsg = String(fallback.message || "").trim();
  const baseMerge = {
    ...preferred,
    name: mergedName ?? preferred.name,
    target: mergedTarget ?? preferred.target,
  };
  const withMessage: T = msg || !fallbackMsg ? baseMerge : { ...baseMerge, message: fallbackMsg };
  const withPush =
    withMessage.hsPushDir || !fallback.hsPushDir
      ? withMessage
      : { ...withMessage, hsPushDir: fallback.hsPushDir };
  const mergedAmount = Math.max(
    0,
    Math.round(Number(preferred.amount ?? fallback.amount) || 0)
  );
  const ineligible = !isDonationAmountEligibleForHighSocietyTerritory(mergedAmount);
  const territoryFlag =
    ineligible || preferred.hsTerritoryExcluded === true
      ? true
      : preferred.hsTerritoryExcluded === false
        ? false
        : fallback?.hsTerritoryExcluded === false
          ? false
          : fallback?.hsTerritoryExcluded === true
            ? true
            : false;
  return {
    ...withPush,
    ...(preferred.donationExcluded || fallback.donationExcluded
      ? { donationExcluded: true as const }
      : {}),
    ...(territoryFlag === true
      ? { hsTerritoryExcluded: true as const }
      : territoryFlag === false
        ? { hsTerritoryExcluded: false as const }
        : {}),
    ...(preferred.groupSplit || fallback.groupSplit ? { groupSplit: true as const } : {}),
    ...(preferred.groupSplitSource || fallback.groupSplitSource
      ? { groupSplitSource: true as const }
      : {}),
  };
}

type DedupeCacheEntry<T> = { storedInputLen: number; result: T[] };
const dedupeIdentityCache = new WeakMap<object[], DedupeCacheEntry<unknown>>();

export function dedupeDonorRows<T extends MergeableDonor>(donors: T[]): T[] {
  if (donors.length === 0) return donors;
  const entry = dedupeIdentityCache.get(donors as unknown as object[]) as
    | DedupeCacheEntry<T>
    | undefined;
  if (entry && entry.storedInputLen === donors.length) {
    return entry.result;
  }
  const map = new Map<string, T>();
  for (const d of donors) {
    const key = donorRowDedupeKey(d);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, d);
      continue;
    }
    if (donorAtEpochMs(d) >= donorAtEpochMs(prev)) {
      map.set(key, mergeDonorRowFields(d, prev));
    } else {
      map.set(key, mergeDonorRowFields(prev, d));
    }
  }
  const pass1 = Array.from(map.values()).sort(
    (a, b) => donorAtEpochMs(b) - donorAtEpochMs(a)
  );

  type MergeableDonorEx = MergeableDonor & { donationExcluded?: boolean };
  /**
   * ✅ 2026-09-06 Hotfix Helper: 서로 다른 strong id를 가진 donor row는 content 유사도와 무관하게 별개 후원으로 간주.
   * dedupeDonorRows / isDuplicateDonationEvent 양쪽 경로 오탐 방지.
   * return true = 중복으로 간주하고 skip/merge 허용, false = id가 다르면 별개 row 유지 */
  function allowMergeByContent(prev: MergeableDonor, incoming: MergeableDonor): boolean {
    const idA = String(prev.id || "").trim();
    const idB = String(incoming.id || "").trim();
    const strongA = Boolean(idA) && !isWeakToonationDonorId(idA);
    const strongB = Boolean(idB) && !isWeakToonationDonorId(idB);
    if (strongA && strongB) {
      if (idA === idB || normalizeDonationEventId(idA) === normalizeDonationEventId(idB)) {
        return true;
      }
      return false;
    }
    return true;
  }

  const MAX_BUCKET_SCAN = 200;
  if (pass1.length <= MAX_BUCKET_SCAN) {
    const merged: T[] = [];
    for (const d of pass1) {
      const dupIdx = merged.findIndex((prev) =>
        allowMergeByContent(prev, d as MergeableDonorEx) &&
        shouldTreatAsDuplicateDonationContent(prev, {
          ...d,
          donorName: d.name,
          externalId: d.externalId,
          rawHash: d.rawHash,
          groupSplit: d.groupSplit,
          groupSplitSource: d.groupSplitSource,
          memberId: d.memberId,
          donationExcluded: d.donationExcluded,
        })
      );
      if (dupIdx < 0) {
        merged.push(d);
        continue;
      }
      const prev = merged[dupIdx]!;
      const aWeak = isWeakToonationDonorId(String(prev.id || ""));
      const bWeak = isWeakToonationDonorId(String(d.id || ""));
      const preferred =
        aWeak && !bWeak
          ? d
          : !aWeak && bWeak
            ? prev
            : donorAtEpochMs(d) >= donorAtEpochMs(prev)
              ? d
              : prev;
      const other = preferred === d ? prev : d;
      merged[dupIdx] = mergeDonorRowFields(preferred, other);
    }
    dedupeIdentityCache.set(donors as unknown as object[], {
      storedInputLen: donors.length,
      result: merged as unknown[],
    });
    return merged;
  }

  const bucket = new Map<string, T[]>();
  for (const d of pass1) {
    const name = normalizeDonorNameKey(d.name);
    const amt = Math.max(0, Math.round(Number(d.amount) || 0));
    const key = `${name ?? ""}\u0001${amt}`;
    const arr = bucket.get(key);
    if (arr) arr.push(d);
    else bucket.set(key, [d]);
  }

  const merged: T[] = [];
  for (const d of pass1) {
    const name = normalizeDonorNameKey(d.name);
    const amt = Math.max(0, Math.round(Number(d.amount) || 0));
    const key = `${name ?? ""}\u0001${amt}`;
    const pool = bucket.get(key);
    let dupIdx = -1;
    if (pool && pool.length <= MAX_BUCKET_SCAN) {
      for (let i = 0; i < merged.length; i += 1) {
        const prev = merged[i]!;
        const pName = normalizeDonorNameKey(prev.name);
        const pAmt = Math.max(0, Math.round(Number(prev.amount) || 0));
        if (pName !== name || pAmt !== amt) continue;
        if (
          allowMergeByContent(prev, d as MergeableDonorEx) &&
          shouldTreatAsDuplicateDonationContent(prev, {
            id: d.id,
            donorName: d.name,
            amount: d.amount,
            target: d.target,
            message: d.message,
            at: d.at,
          })
        ) {
          dupIdx = i;
          break;
        }
      }
    } else {
      dupIdx = merged.findIndex((prev) =>
        allowMergeByContent(prev, d as MergeableDonorEx) &&
        shouldTreatAsDuplicateDonationContent(prev, {
          id: d.id,
          donorName: d.name,
          amount: d.amount,
          target: d.target,
          message: d.message,
          at: d.at,
        })
      );
    }
    if (dupIdx < 0) {
      merged.push(d);
      continue;
    }
    const prev = merged[dupIdx]!;
    const aWeak = isWeakToonationDonorId(String(prev.id || ""));
    const bWeak = isWeakToonationDonorId(String(d.id || ""));
    const preferred =
      aWeak && !bWeak
        ? d
        : !aWeak && bWeak
          ? prev
          : donorAtEpochMs(d) >= donorAtEpochMs(prev)
            ? d
            : prev;
    const other = preferred === d ? prev : d;
    merged[dupIdx] = mergeDonorRowFields(preferred, other);
  }
  dedupeIdentityCache.set(donors as unknown as object[], {
    storedInputLen: donors.length,
    result: merged as unknown[],
  });
  return merged;
}

export function donationQueueIdsForDonor(donor: { id?: string }): string[] {
  const rawId = String(donor.id || "").trim();
  if (!rawId) return [];
  const baseId = normalizeDonationEventId(rawId);
  const out = new Set<string>([rawId, baseId, `${baseId}::review`]);
  const externalId = baseId.replace(/^toonation:/i, "");
  if (externalId && externalId !== baseId) {
    out.add(`toonation:${externalId}`);
    out.add(`toonation:${externalId}::review`);
  }
  return Array.from(out);
}

export function countableDonorTotal(donors: Donor[] | undefined): number {
  return dedupeDonorRows(donors || [])
    .filter((d) => !isDonorExcludedFromDonationTotals(d))
    .reduce((sum, d) => sum + Math.max(0, Math.round(Number(d.amount) || 0)), 0);
}

export function rosterDonorMatchScore(
  members: { id?: string }[] | null | undefined,
  donors: Donor[] | null | undefined
): number {
  const ids = new Set(
    (members || []).map((m) => String(m.id || "").trim()).filter(Boolean)
  );
  if (ids.size === 0) return 0;
  let score = 0;
  for (const d of donors || []) {
    if (isDonorExcludedFromDonationTotals(d)) continue;
    const mid = String(d.memberId || "").trim();
    if (!mid || !ids.has(mid)) continue;
    score += Math.max(0, Math.round(Number(d.amount) || 0));
  }
  return score;
}

export function isDuplicateDonationEvent(
  state: { donors?: Donor[] },
  rawEvent: {
    id?: string;
    donorName?: string;
    amount?: number;
    at?: number | string;
    target?: string;
    message?: string;
    externalId?: string;
    provider?: string;
    manualAssignMemberId?: string;
    memberId?: string;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
  }
): boolean {
  const donors = state.donors || [];
  const eventId = String(rawEvent.id || "").trim();
  const baseId = normalizeDonationEventId(eventId);
  const externalId = String(rawEvent.externalId || "").trim();
  const externalDonorId = externalId && rawEvent.provider ? `${rawEvent.provider}:${externalId}` : "";
  const probeDonor = {
    id: eventId || externalDonorId,
    name: rawEvent.donorName,
    amount: rawEvent.amount,
    at: rawEvent.at,
    target: rawEvent.target,
    message: rawEvent.message,
    externalId: externalId,
    rawHash: rawEvent.id,
    groupSplit: Boolean((rawEvent as { groupSplit?: boolean }).groupSplit),
    groupSplitSource: Boolean((rawEvent as { groupSplitSource?: boolean }).groupSplitSource),
    memberId:
      String((rawEvent as { memberId?: string })?.memberId || "").trim() || undefined,
  };
  const probeKey = donorRowDedupeKey(probeDonor);
  const isOwnerRemapSplitDuplicate = (
    existing: {
      name?: string;
      amount?: number;
      target?: string;
      message?: string;
      at?: number | string;
      memberId?: string;
    },
    incoming: {
      donorName?: string;
      amount?: number;
      target?: string;
      message?: string;
      at?: string | number;
      memberId?: string;
    }
  ) => {
    const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
    const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
    if (amountA <= 0 || amountA !== amountB) return false;
    const atA = donorAtEpochMs(existing);
    const atB = donorAtEpochMs(incoming);
    if (Math.abs(atA - atB) > DONATION_NEAR_DUP_WINDOW_MS) return false;
    const targetA = (t?: string): "account" | "toon" => (t === "toon" ? "toon" : "account");
    const targetB = targetA;
    if (targetA(existing.target) !== targetB(incoming.target)) return false;
    const memA = String(existing.memberId || "").trim();
    const memB = String(incoming.memberId || "").trim();
    if (memA && memB && memA !== memB) return false;
    const msgA = String(existing.message || "").trim().toLowerCase();
    const msgB = String(incoming.message || "").trim().toLowerCase();
    if (msgA && msgB && msgA === msgB) return true;
    const nameA = String(existing.name || "").trim().toLowerCase();
    const nameB = String(incoming.donorName || "").trim().toLowerCase();
    if (msgA && nameB && msgA.includes(nameB)) return true;
    if (msgB && nameA && msgB.includes(nameA)) return true;
    if (!msgA && !msgB) {
      const anon = (n: string) => {
        const t = String(n || "").trim().toLowerCase();
        return t === "익명" || t === "anonymous" || t === "anon" || t === "unknown";
      };
      if (anon(nameA) || anon(nameB)) return true;
    }
    return false;
  };
  const donorExcluded = (d: { donationExcluded?: boolean }) =>
    isDonorExcludedFromDonationTotals(d);
  return donors.some((d) => {
    const donorId = String(d.id || "").trim();
    if (!donorId) return false;
    /**
     * ✅ 2026-09-06 Hotfix: 4연속 후원 1건만 남는 오탐 Fix
     * 두 행(donor.d vs incoming event) 모두 명시적인 id가 존재하고 **id가 다르면** →
     * content(name+amount+target+3s window)가 일치하더라도 절대 중복으로 보지 않고 정상 연타 후원으로 간주.
     * 서로 다른 id는 DIN 허브/투네이션에서 엄연히 발급된 별개 후원 ID 이므로,
     * 과거 near-content dedup의 보험 로직(content 유사도 기반 병합)이 정상 후원을 지우는 오탐을 방지.
     * fallback 레거시 donor (id가 없는 행)에 대해서만 기존 content dedup 보험 로직을 그대로 유지. */
    const incomingHasStrongId = Boolean(eventId) && !isWeakToonationDonorId(eventId);
    const existingHasStrongId = !isWeakToonationDonorId(donorId);
    if (incomingHasStrongId && existingHasStrongId && donorId !== eventId) {
      // proceed to id exact match checks 아래에서만 중복 판정, content match는 무시
    } else if (incomingHasStrongId && existingHasStrongId && normalizeDonationEventId(donorId) === normalizeDonationEventId(eventId)) {
      return true;
    } else {
      if (
        shouldTreatAsDuplicateDonationContent(d, {
          ...probeDonor,
          id: eventId || externalDonorId,
          externalId,
        })
      ) {
        return true;
      }
    }
    if (donorRowDedupeKey(d) === probeKey) return true;
    if (donorId === eventId || donorId === baseId) return true;
    if (baseId && normalizeDonationEventId(donorId) === baseId) return true;
    if (
      externalDonorId &&
      (donorId === externalDonorId || normalizeDonationEventId(donorId) === externalDonorId)
    ) {
      return true;
    }
    if (externalId) {
      const normDonor = normalizeDonationEventId(donorId);
      if (
        normDonor.endsWith(`:${externalId}`) ||
        normDonor === `toona:${externalId}` ||
        normDonor === `toonation:${externalId}` ||
        normDonor === `bank:din:${externalId}` ||
        normDonor === `toonation:din:${externalId}`
      ) {
        return true;
      }
    }
    if (isOwnerRemapSplitDuplicate(d, rawEvent)) return true;
    return false;
  });
}
