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
  /**
   * ✅ 2026-09-07 Hotfix 6-10 death-loop Fix:
   *  기존 /^toonation:(.+)$/i.exec(baseId) regex Bug: normalize 후 provider prefix 가 제거된 baseId=12345 에서 매치 불가 → null.
   *  strong id 분기를 완전히 놓치고 weak fallback bucket key 로 빠져서 → `toonation:12345` (realtime SSE) vs `toonation:din:12345` (fetch polling)
   *  이 서로 다른 bucket key 로 pass1 map 에 분리 저장 → merge 자체가 안일어나서 → 사용자가 수동 삭제한 excluded=true 플래그가 전혀 전파되지 않았던 악순환!
   *
   * 변경 분기: baseId 존재 AND !isWeak(rawId) → 무조건 strong toonation bucket key `toonation:${baseId}` 통일 사용
   *   → 두가지 ID format 이 100% 같은 bucket 에 들어가서 merge 가 강제 발생 → excluded lock 양쪽에 상속 → 사용자 삭제 후 다시 fetch 로 들어와도 자동으로 excluded 유지!
   */
  const hasStrongToonationId = Boolean(baseId) && !isWeakToonationDonorId(rawId);
  if (hasStrongToonationId) {
    return `toonation:${baseId.toLowerCase()}`;
  }
  if (baseId) {
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

  /**
   * ✅ 2026-09-07 Hotfix ⑥-4 깜빡임 원천 봉쇄:
   *  한번 저장된 donor 의 **핵심 필드 (amount / at / id / message / donorKey 등)** 는 절대 덮어쓰지 않음.
   *  fallback (기존 state 저장값) 이 존재하는 값은 100% 유지 · preferred 는 오직 fallback 에 값이 아예 없을때만 backfill 보충.
   *  이전 baseMerge = {...preferred} 규칙은 60초 fetch 마다 새로 들어온 DIN 허브 row 가 정상 저장된 기존 donor 의
   *  금액·시간·메시지를 뒤바꿔서 "늘었다 줄었다 깜빡거리는 현상"의 직접 원인이었음.
   *  오직 메타 필드 (displayName 종합 우선순위 / target 매칭 결과 등) 만 신뢰도 기반으로 비교.
   */
  const FALLBACK_PRIMARY_FIELDS = [
    "id", "donorKey", "primaryKey", "externalId", "provider",
    "amount", "at", "createdAt", "ts",
    "message", "memo", "rawMessage",
    "donorName", "nickname", "displayName", "name",
    "formula", "contributionPoints",
    "memberId", "teamId", "battleId", "battleTeamId",
    "bankAccountBank", "bankAccountHolder", "bankAccountNumber",
    "settlementLabel", "groupSplitSourceId",
  ] as const;
  function primaryValue<K extends (typeof FALLBACK_PRIMARY_FIELDS)[number]>(key: K): unknown {
    const fb = (fallback as any)?.[key];
    const pf = (preferred as any)?.[key];
    if (fb === undefined || fb === null || fb === "") return pf;
    return fb;
  }
  // 1. 먼저 fallback 값을 100% 우선으로 base 를 깔고 → preferred backfill
  const baseLocked: any = { ...fallback };
  for (const k of FALLBACK_PRIMARY_FIELDS) {
    const v = primaryValue(k);
    if (v !== undefined && v !== null) baseLocked[k] = v;
  }
  // fallback 의 기본 name/target 을 잃지 않기 위해 미리 잡아둠
  const fbAny = fallback as any;
  const pfAny = preferred as any;
  const finalFallbackName = String(
    fbAny?.name || fbAny?.donorName || fbAny?.nickname || fbAny?.displayName || ""
  ).trim();
  const finalFallbackTarget = String(fallback.target || "").trim();
  if (finalFallbackName && !baseLocked.name) baseLocked.name = finalFallbackName;
  if (finalFallbackTarget && !baseLocked.target) baseLocked.target = finalFallbackTarget;

  const usePrefForMeta =
    relPref > relFall
      ? true
      : relFall > relPref
        ? false
        : String(preferred.name || preferred.donorName || "").length >=
          String(fallback.name || fallback.donorName || "").length;
  const bestNameSrc: T = usePrefForMeta ? preferred : fallback;
  const bestTargetSrc: T = usePrefForMeta ? preferred : fallback;
  const bnsAny = bestNameSrc as any;
  const mergedNameRaw = String(
    bnsAny?.name || bnsAny?.donorName || bnsAny?.nickname || bnsAny?.displayName || ""
  ).trim();
  const mergedName = finalFallbackName || mergedNameRaw || undefined;
  const rawPrefTarget = String(preferred.target || "").trim();
  const rawFallTarget = String(fallback.target || "").trim();
  const targetBest = String(bestTargetSrc.target || "").trim();
  const mergedTarget = finalFallbackTarget || targetBest || rawPrefTarget || rawFallTarget || undefined;

  const fallbackMsg = String(fbAny?.message || fbAny?.memo || "").trim();
  const prefMsg = String(pfAny?.message || pfAny?.memo || "").trim();
  const mergedMsg = fallbackMsg || prefMsg || undefined;

  const baseMerge: any = {
    ...baseLocked,
    ...(mergedName ? { name: mergedName } : {}),
    ...(mergedTarget ? { target: mergedTarget } : {}),
    ...(mergedMsg ? { message: mergedMsg } : {}),
  };
  const withPush: any =
    fallback.hsPushDir || !preferred.hsPushDir
      ? { ...baseMerge, hsPushDir: fallback.hsPushDir || baseMerge.hsPushDir }
      : baseMerge;
  const mergedAmount = Math.max(
    0,
    Math.round(Number(fallback.amount ?? preferred.amount) || 0)
  );
  const ineligible = !isDonationAmountEligibleForHighSocietyTerritory(mergedAmount);
  const territoryFlag =
    ineligible || fallback.hsTerritoryExcluded === true
      ? true
      : fallback.hsTerritoryExcluded === false
        ? false
        : preferred?.hsTerritoryExcluded === false
          ? false
          : preferred?.hsTerritoryExcluded === true
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

  /**
   * ✅ 2026-09-07 Hotfix ⑥-4 SHRINK GUARD (Monotonic Increase Invariant):
   *  "데이터가 있으면 있는대로 보여주세요 · 늘었다 줄었다 깜빡이면서 사라지면 안됨" → 사용자 요구사항.
   *  어떤 경로(SSE stale · fetch 폴링 race · dedupe 오판 등) 로 들어오던지 간에
   *  최종 dedupe 결과 donors 는 절대 원본 입력 donors 의 유니크 ID 갯수보다 적어져서는 안된다.
   *  만약 병합 과정에서 실수로 strong id 1개를 잃어버렸다면 원본 donors 에만 존재하는 ID들을
   *  강제로 뒤에 union append 해서 "원본에 있던건 최소한 다 나온다" 는 invariant 를 100% 보장.
   */
  function applyMonotonicShrinkGuard(finalMerged: T[]): T[] {
    const mergedNormIds = new Set<string>();
    for (const m of finalMerged) {
      const raw = String(m.id || "").trim();
      if (!raw) continue;
      mergedNormIds.add(normalizeDonationEventId(raw) || raw);
    }
    /**
     * ✅ 2026-09-07 Hotfix 6-10 "신규 후원 추가시 과거 후원 1건 덧나는 딱기둘 패턴" 원천 봉쇄:
     *  1차 norm ID set 만으로는 bucket collision merge 로 소실된 서로 다른 donor A 를 "lost unique" 로 false-positive 오판하여
     *  과거 원본 donors 배열에서 꺼내와 append 하는 교차 오염 현상을 막기 위해 2차 유사도 검증 추가.
     *  append 하기 전에 이미 merged 배열 내에 "동일 donor + 동일 amount + atMs 차이 ≤ 3600초 (1시간)" donor 가 존재하면
     *   → lost unique 로 오판한 append 후보를 폐기 → append 하지 않음 (교차 오염 방지)
     */
    const mergedSnap = finalMerged.slice(0);
    function hasTwinInMerged(cand: T): boolean {
      const cD = cand as unknown as { name?: string; displayName?: string; amount?: number; at?: number; message?: string };
      const cName = normalizeDonorNameKey(String(cD.displayName || cD.name || ""));
      if (!cName) return false;
      const cAmt = Math.round(Number(cD.amount || 0));
      const cAt = Math.round(Number(cD.at || 0));
      for (const m of mergedSnap) {
        const mD = m as unknown as { name?: string; displayName?: string; amount?: number; at?: number; message?: string };
        const mName = normalizeDonorNameKey(String(mD.displayName || mD.name || ""));
        if (mName !== cName) continue;
        const mAmt = Math.round(Number(mD.amount || 0));
        if (mAmt > 0 && cAmt > 0 && Math.abs(mAmt - cAmt) >= 1) continue;
        const mAt = Math.round(Number(mD.at || 0));
        if (mAt > 0 && cAt > 0) {
          if (Math.abs(mAt - cAt) <= 60 * 60 * 1000) return true; // 동일 donor + 금액 같고 시간 1시간 이내면 같은 행으로 간주 (이미 존재함 → lost unique 아님!)
        } else {
          return true; // at 누락인 경우는 donor+amount 만 같아도 이미 있다고 간주 (보수적)
        }
      }
      return false;
    }
    const appendLostUnique: T[] = [];
    for (const orig of donors) {
      const raw = String(orig.id || "").trim();
      if (!raw) continue;
      const norm = normalizeDonationEventId(raw) || raw;
      if (mergedNormIds.has(norm)) continue;
      if (hasTwinInMerged(orig)) continue; // ✅ 2차 검증: 이미 merged 에 동일 donor·금액·시간 행이 존재하면 → false-positive lost unique 이므로 append 스킵
      mergedNormIds.add(norm);
      appendLostUnique.push(orig);
    }
    if (appendLostUnique.length === 0) return finalMerged;
    return [...finalMerged, ...appendLostUnique].sort(
      (a, b) => donorAtEpochMs(b) - donorAtEpochMs(a)
    );
  }

  const map = new Map<string, T>();
  // ✅ bucket collision 으로 인한 서로 다른 donor 간 교차 merge 를 원천 봉쇄하는 split counter
  //    동일 donorRowDedupeKey 에 2개 이상의 donor 가 들어왔으나 allowMergeByIdOnly=false (진짜 다른 후원) 일때
  //    key 뒤에 #1, #2, #3 suffix 붙여서 Map 에 개별 저장 → 절대 교차 merge 안함
  let splitSeed = 0;
  function saveWithCollisionGuard(rawKey: string, value: T, allowMerge: (prev: T, cur: T) => boolean): void {
    const existing = map.get(rawKey);
    if (!existing) {
      map.set(rawKey, value);
      return;
    }
    const doMerge = allowMerge(existing, value);
    if (doMerge) {
      if (donorAtEpochMs(value) >= donorAtEpochMs(existing)) {
        map.set(rawKey, mergeDonorRowFields(value, existing) as T);
      } else {
        map.set(rawKey, mergeDonorRowFields(existing, value) as T);
      }
      return;
    }
    // ❗ allowMerge=false → 진짜 다른 후원인데 bucket key 가 hash collision 으로 겹친것!
    //   절대 merge 하지 않고 suffix 붙여 별도 key 로 분리 저장 → 교차 오염 0%
    splitSeed += 1;
    const altKey = `${rawKey}#split${splitSeed}`;
    let tries = 0;
    let finalKey = altKey;
    while (map.has(finalKey) && tries < 50) {
      splitSeed += 1;
      tries += 1;
      finalKey = `${rawKey}#split${splitSeed}`;
    }
    map.set(finalKey, value);
  }
  /**
   * ✅ 2026-09-07 Hotfix 6-10 삭제 악순환 차단 2차 방어:
   *  pass1 bucket key 오류로 (과거 baseline) merge 가 누락된 경우에도 안전하게 excluded lock 을 전파.
   *  · donors 전체를 먼저 1회 순회 → norm ID 별로 "한명이라도 donationExcluded=true 인 적 있는지" 조사
   *  · excluded 된 norm ID 는 → bucket merge 이후 "만약에 merge 누락됐어도" 새로 유입된 같은 ID donor 에 excluded 를 사전 주입
   *  결과: 사용자가 1번 삭제한 후원은 어떤 ID format 으로 다시 유입되든 절대 UI에 노출되지 않음
   */
  const excludedNormIds = new Set<string>();
  for (const d of donors) {
    const raw = String(d.id || "").trim();
    if (!raw) continue;
    const norm = normalizeDonationEventId(raw) || raw;
    if (!norm) continue;
    const excluded = Boolean((d as unknown as { donationExcluded?: boolean }).donationExcluded);
    if (excluded) excludedNormIds.add(norm);
  }
  for (const orig of donors) {
    const raw = String(orig.id || "").trim();
    const norm = raw ? normalizeDonationEventId(raw) || raw : "";
    if (norm && excludedNormIds.has(norm) && !Boolean((orig as unknown as { donationExcluded?: boolean }).donationExcluded)) {
      (orig as unknown as { donationExcluded: boolean }).donationExcluded = true;
    }
  }
  for (const d of donors) {
    const key = donorRowDedupeKey(d);
    saveWithCollisionGuard(key, d, (prev, cur) => allowMergeByIdOnly(prev, cur));
  }
  const pass1 = Array.from(map.values()).sort(
    (a, b) => donorAtEpochMs(b) - donorAtEpochMs(a)
  );

  type MergeableDonorEx = MergeableDonor & { donationExcluded?: boolean };
  /**
   * ✅ 2026-09-07 Hotfix ⑥-10 Fix 간헐적 후원 2개씩 쌓임 Bug:
   *  두가지 서로 다른 ID 발급 경로가 동일 externalId 에 대해 서로 다른 format 을 내뱉어
   *   · 실시간 SSE/Webhook:  `toonation:${externalId}`  →  `toonation:12345`
   *   · B-mode 1분 fetch:   `${provider}:din:${externalId}` → `toonation:din:12345`
   *  이전 ⑥-6 ID ONLY RULE 은 format 이 다르면 ID 가 다르다고 오판 → 진짜 같은 후원이 2행으로 적재되었음.
   *
   *  Fix 적용된 merge 규칙 (OR):
   *   1. normalizeDonationEventId 로 provider/din prefix 전부 제거하고 비교 → 동일 externalId 이면 무조건 merge
   *   2. norm 결과가 달라도 4가지 전부 AND 로 만족 → 무조건 merge (2차 안전망):
   *        donor 완전일치 + amount 완전일치 + atMs 차이 ≤ 1000ms + message 완전일치
   *   3. 그 외 모든 경우 → return false (별개 후원으로 "있는 그대로" 개별 row 유지)
   */
  function allowMergeByIdOnly(prev: MergeableDonor, incoming: MergeableDonor): boolean {
    const idA = String(prev.id || "").trim();
    const idB = String(incoming.id || "").trim();
    if (!idA || !idB) return false;
    const normA = normalizeDonationEventId(idA) || idA;
    const normB = normalizeDonationEventId(idB) || idB;
    if (normA === normB) return true;

    // 2차 안전망: ID 불일치여도 동일 donor + 동일 amount + 동일 at 1초 + 동일 msg → merge 허용
    // 타입 캐스팅 DonorLike: donor pipeline 호출은 Donor 타입을 넘기지만 제네릭이어서 속성 any 접근 허용
    const dA = prev as unknown as {
      displayName?: string;
      name?: string;
      amount?: number;
      at?: number;
      message?: string;
    };
    const dB = incoming as unknown as {
      displayName?: string;
      name?: string;
      amount?: number;
      at?: number;
      message?: string;
    };
    const donorA = normalizeDonorNameKey(String(dA.displayName || dA.name || ""));
    const donorB = normalizeDonorNameKey(String(dB.displayName || dB.name || ""));
    if (donorA && donorA === donorB) {
      const amtA = Math.round(Number(dA.amount || 0));
      const amtB = Math.round(Number(dB.amount || 0));
      if (amtA > 0 && amtA === amtB) {
        const atA = Math.round(Number(dA.at || 0));
        const atB = Math.round(Number(dB.at || 0));
        if (atA > 0 && atB > 0 && Math.abs(atA - atB) <= 1_000) {
          const mA = String(dA.message || "").replace(/\s+/g, "").toLowerCase();
          const mB = String(dB.message || "").replace(/\s+/g, "").toLowerCase();
          if (mA === mB) return true;
        }
      }
    }
    return false;
  }

  const MAX_BUCKET_SCAN = 200;
  if (pass1.length <= MAX_BUCKET_SCAN) {
    const merged: T[] = [];
    for (const d of pass1) {
      const dupIdx = merged.findIndex((prev) =>
        allowMergeByIdOnly(prev, d as MergeableDonor)
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
    const guarded = applyMonotonicShrinkGuard(merged);
    /** ✅ 2026-09-07 Hotfix ⑥-5: 새로운 후원은 제일 위에 남는게 맞습니다 = at 최신순(내림차순) 강제.
     *  merge 과정에서 순서가 뒤섞이는 모든 케이스를 차단하기 위해 최종 return 직전 한번 더 정렬. */
    const sorted = [...guarded].sort(
      (a, b) => donorAtEpochMs(b) - donorAtEpochMs(a)
    );
    dedupeIdentityCache.set(donors as unknown as object[], {
      storedInputLen: donors.length,
      result: sorted as unknown[],
    });
    return sorted;
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
    let dupIdx = -1;
    // ✅ 2026-09-07 Hotfix ⑥-6: bucket 스캔에서도 오직 ID 100% 일치만 merge 허용
    for (let i = 0; i < merged.length; i += 1) {
      const prev = merged[i]!;
      if (allowMergeByIdOnly(prev, d as MergeableDonor)) {
        dupIdx = i;
        break;
      }
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
  const guarded = applyMonotonicShrinkGuard(merged);
  /** ✅ 2026-09-07 Hotfix ⑥-5: 새로운 후원은 제일 위에 남는게 맞습니다 = at 최신순(내림차순) 강제.
   *  merge 과정에서 순서가 뒤섞이는 모든 케이스를 차단하기 위해 최종 return 직전 한번 더 정렬. */
  const sorted = [...guarded].sort(
    (a, b) => donorAtEpochMs(b) - donorAtEpochMs(a)
  );
  dedupeIdentityCache.set(donors as unknown as object[], {
    storedInputLen: donors.length,
    result: sorted as unknown[],
  });
  return sorted;
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
    /** ✅ 2026-09-07 Hotfix ⑥-6 최종: 있는 그대로 ID ONLY 중복 체크.
     *  기존: isOwnerRemapSplitDuplicate (시간·메시지·금액·이름 유사도 기반 near-dup 검사) +
     *        shouldTreatAsDuplicateDonationContent (15초 identical 메시지 윈도우) 등으로
     *        우리가 알아서 "비슷해 보이면 중복" 이라고 판단해서 row 를 날리는 로직 존재 →
     *        사용자 요청 "있는 그대로의 데이터 보여줘야지" 와 상반되어 전부 제거.
     *  최종 RULE: ID 100% 일치 (아래 5가지 ID 매칭 중 1개라도 true) → 중복 return true
     *             ID가 한글자라도 다르면 → 무조건 false (별개 후원으로 있는 그대로 처리)
     *             시간·메시지·금액·이름이 100% 같아도 ID 다르면 중복 아님! */
    const donorIdNorm = normalizeDonationEventId(donorId);
    const eventIdNorm = normalizeDonationEventId(eventId);
    if (donorIdNorm && eventIdNorm && donorIdNorm === eventIdNorm) return true;
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
    // ✅ ⑥-6: 위 5가지 ID 매칭에 전부 해당 안되면 → ID가 다르다는 뜻 = 절대 중복 아님. (메시지·시간·금액 같아도!)
    return false;
  });
}
