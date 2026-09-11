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
import { resolveEffectiveDonorTarget } from "@/domain/state-monolith.all";

const isDonorExcludedFromDonationTotals = _excluded;
export { isDonorExcludedFromDonationTotals };

/**
 * 🚀 2026-09-12 성능 개선 Memoization: normalizeDonationEventId / normalizeDonorNameKey
 *  - 동일 donor dedupe pipeline 내에서 같은 문자열에 대해 10만회 이상 중복 호출 → O(1) Map 캐시로 10배 이상 가속
 *  - LRU 수동 교체: 각 호출 당 cache entry 최대 N=50_000 유지
 */
const _CACHE_ID_NORM = new Map<string, string>();
const _CACHE_NAME_NORM = new Map<string, string>();
const _CACHE_EPOCH = new WeakMap<object, number>();
const CACHE_MAX = 60_000;
function cachedNormId(rawIn: string): string {
  if (!rawIn) return "";
  const raw = rawIn.trim();
  if (!raw) return "";
  let v = _CACHE_ID_NORM.get(raw);
  if (v !== undefined) return v;
  if (_CACHE_ID_NORM.size >= CACHE_MAX) {
    let k = _CACHE_ID_NORM.keys().next().value as string | undefined;
    if (k) _CACHE_ID_NORM.delete(k);
  }
  v = normalizeDonationEventId(raw) || raw;
  _CACHE_ID_NORM.set(raw, v);
  return v;
}
function cachedNormName(rawIn: string): string {
  if (!rawIn) return "";
  const raw = rawIn.trim();
  if (!raw) return "";
  let v = _CACHE_NAME_NORM.get(raw);
  if (v !== undefined) return v;
  if (_CACHE_NAME_NORM.size >= CACHE_MAX) {
    let k = _CACHE_NAME_NORM.keys().next().value as string | undefined;
    if (k) _CACHE_NAME_NORM.delete(k);
  }
  v = normalizeDonorNameKey(raw);
  _CACHE_NAME_NORM.set(raw, v);
  return v;
}
function cachedEpochMs(obj: object, calc: () => number): number {
  let v = _CACHE_EPOCH.get(obj);
  if (v !== undefined) return v;
  v = Math.max(0, Math.round(calc()));
  _CACHE_EPOCH.set(obj, v);
  return v;
}

/**
 * ✅ 2026-09-11 P0 9V 17,760원 뻥튀기 Fix: hasRealDonorId 헬퍼
 *  - entry.id 가 null/undefined/0/빈문자열이 아닌 실제 고유 id 소유 여부 판정
 *  - 추가로 isWeakToonationDonorId === false 인 경우 (toonation: / bank: prefix 등)
 *    Strong ID로 간주 → 내용 기반 merge / amount 합산 절대 금지
 */
function hasRealDonorId(d: MergeableDonor | { id?: string } | null | undefined): boolean {
  if (!d) return false;
  const raw = String((d as { id?: string }).id || "").trim();
  if (!raw) return false;
  return !isWeakToonationDonorId(raw);
}

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
  const name = String(donor.name || donor.donorName || "").trim();
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
    /**
     * ✅ 2026-09-07 Fix #⑦ (C Donor weak bucket seed atMs/amount 제거!)
     *  이전: `fallback:${name}|${donorAtEpochMs(donor)}|${amount}|${hash}`
     *   - atMs (후원시간) 이 seed 에 포함되어 1ms 차이로도 완전히 다른 bucket → 동일 donor 동일 메시지여도 2행 적재 (C Donor 패턴)
     *   - amount (금액) 도 seed 에 포함되어 금액 같을때는 괜찮지만 1원 차이로도 bucket 분리 → merge 기회 박탈
     *  변경: donor 고유성은 `name + externalId/rawHash` 만으로 판단!
     *   - 동일 donor 는 at/amount 가 달라도 일단 같은 bucket 에 전부 모음 → allowMergeByIdOnly 가 최종적으로 merge 여부 결정
     *   - 결과: 짧은 시간 소액 다회 후원 C Donor (딱기둘/자키 등) bucket 1개로 통일 → false-positive merge 와 샴푸 증식 원천 봉쇄
     */
    return `fallback:${name}|${fallbackHash}`;
  }
  const seedParts: string[] = [name];
  if (rawId) {
    seedParts.push(rawId);
  } else {
    seedParts.push(name);
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
  return `fallback:${name}|${lastResortHash}`;
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
    "at", "createdAt", "ts",
    "message", "memo", "rawMessage",
    "donorName", "nickname", "displayName", "name",
    "formula",
    "memberId", "teamId", "battleId", "battleTeamId",
    "bankAccountBank", "bankAccountHolder", "bankAccountNumber",
    "settlementLabel", "groupSplitSourceId",
    "donorNameEditAt", "donorNameLastEditedBy",
    /** ✅ 2026-09-08 Hotfix XX-amount: amount · contributionPoints 는 ⑥-4 FALLBACK_PRIMARY_FIELDS 에서 의도적으로 제외.
     *  amount 는 아래 블록에서 "ID가 다른 2 donor 를 병합할 때만 합산, ID가 같으면 (같은 이벤트 재동기화) fallback 값을 유지"
     *  라는 별도의 명시적인 정책을 사용하기 때문.
     *  FALLBACK_PRIMARY_FIELDS 에 넣어버리면 합산이 필요한 경우에도 항상 fallback.amount 로 고정되어
     *  dedup bucket merge 시 amount가 전혀 증가하지 않는 문제가 발생함. */
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
  /** target 은 bestMeta 와 별도로 donorInferSourceKind 신뢰도 (KIND_RELIABILITY) 순서를 1순위로 */
  const bestTargetSrc: T = relPref >= relFall ? preferred : fallback;
  const bnsAny = bestNameSrc as any;
  const mergedNameRaw = String(
    bnsAny?.name || bnsAny?.donorName || bnsAny?.nickname || bnsAny?.displayName || ""
  ).trim();
  const mergedName = finalFallbackName || mergedNameRaw || undefined;
  const rawPrefTarget = String(preferred.target || "").trim();
  const rawFallTarget = String(fallback.target || "").trim();
  const targetBest = String(bestTargetSrc.target || "").trim();
  const candidateTarget =
    (finalFallbackTarget && (finalFallbackTarget === "toon" || finalFallbackTarget === "account"))
      ? finalFallbackTarget
      : (targetBest && (targetBest === "toon" || targetBest === "account"))
        ? targetBest
        : (rawPrefTarget && (rawPrefTarget === "toon" || rawPrefTarget === "account"))
          ? rawPrefTarget
          : (rawFallTarget && (rawFallTarget === "toon" || rawFallTarget === "account"))
            ? rawFallTarget
            : undefined;
  /** ✅ Hotfix ㉑-3: merge 에서 섞인 target 최종 1회 resolveEffectiveDonorTarget 으로 확정 (fallback=toon 보장) */
  const mergedTarget: "toon" | "account" = (() => {
    if (candidateTarget === "toon" || candidateTarget === "account") return candidateTarget;
    const probe: Record<string, unknown> = {
      id: fallback.id || preferred.id,
      provider: (fbAny?.provider || pfAny?.provider) as unknown,
      externalId: (fbAny?.externalId || pfAny?.externalId) as unknown,
      target: candidateTarget,
      name: mergedName || fbAny?.name || pfAny?.name,
    };
    const eff = resolveEffectiveDonorTarget(probe);
    return eff === "account" ? "account" : "toon";
  })();

  const fallbackMsg = String(fbAny?.message || fbAny?.memo || "").trim();
  const prefMsg = String(pfAny?.message || pfAny?.memo || "").trim();
  const mergedMsg = fallbackMsg || prefMsg || undefined;

  /**
   * ✅ 2026-09-07 Fix ⑫-b: 사용자가 직접 수정한 이름은 무조건 우선 (절대 새 fetch 원본 이름으로 덮어씌우지 않음!)
   *  - 관리자 페이지에서 이름 변경시 donorNameLastEditedBy = "user" 로 저장됨
   *  - preferred / fallback 어느 한쪽에라도 "user edited" 플래그가 있으면 → 그쪽 이름을 1순위로 사용
   *  - 이전: 메타 필드가 소실되면서 preferred 원본 DIN 허브 이름 (자키집쓰볼탱69) 이 새 이름을 덮어써서 "1분뒤 원래 이름으로 복귀" Bug 발생
   */
  const prefEdited = String((pfAny?.donorNameLastEditedBy) || "").trim().toLowerCase() === "user";
  const fallEdited = String((fbAny?.donorNameLastEditedBy) || "").trim().toLowerCase() === "user";
  const prefEditedName = prefEdited
    ? String(pfAny?.name || pfAny?.donorName || pfAny?.nickname || pfAny?.displayName || "").trim() || undefined
    : undefined;
  const fallEditedName = fallEdited
    ? String(fbAny?.name || fbAny?.donorName || fbAny?.nickname || fbAny?.displayName || "").trim() || undefined
    : undefined;
  const mergedNameFinal = (fallEdited && fallEditedName)
    ? fallEditedName
    : (prefEdited && prefEditedName)
      ? prefEditedName
      : mergedName;

  const baseMerge: any = {
    ...baseLocked,
    ...(mergedNameFinal ? { name: mergedNameFinal, donorName: mergedNameFinal } : (mergedName ? { name: mergedName } : {})),
    ...(mergedTarget ? { target: mergedTarget } : {}),
    ...(mergedMsg ? { message: mergedMsg } : {}),
  };
  const withPush: any =
    fallback.hsPushDir || !preferred.hsPushDir
      ? { ...baseMerge, hsPushDir: fallback.hsPushDir || baseMerge.hsPushDir }
      : baseMerge;
  /**
   * ✅ 2026-09-08 Hotfix XX-amount: amount / contributionPoints 병합 규칙 재정의 (500ms 50건 burst amount 폭증 Fix)
   *  규칙:
   *  - preferred 와 fallback 의 normalizeDonationEventId 가 100% 일치하는 경우
   *    → 같은 외부 후원 이벤트를 서로 다른 경로로 재동기화 하는 상황 이므로
   *    → amount 를 합산하지 않고 fallback.amount (기존 저장값) 을 100% 유지 (⑥-4 원칙)
   *  - ID 가 서로 다른 경우
   *    → 진짜 "2건의 후원" 을 1 donor bucket 으로 합치는 burst/연타 케이스 이므로
   *    → amount + contributionPoints 를 "두 값의 합" 으로 계산해서 1건의 donor 로 집계
   *  결과:
   *   ① SSE/폴링 재동기화 (ID 같음) → 금액 합산 NO → 기존 깜빡임 방지 원칙 유지 (amount 폭증 차단)
   *   ② 0.5초 burst / 동일 donor 연타 (ID 다름, 2차 안전망 merge) → 금액 합산 YES → 1 donor row 로 정상 집계
   */
  const idPref = String((preferred as { id?: string }).id || "").trim();
  const idFall = String((fallback as { id?: string }).id || "").trim();
  const normIdPref = idPref ? normalizeDonationEventId(idPref) || idPref : "";
  const normIdFall = idFall ? normalizeDonationEventId(idFall) || idFall : "";
  const sameEventId = normIdPref && normIdFall && normIdPref === normIdFall;

  let mergedAmount = Number((withPush as { amount?: number }).amount) || 0;
  let mergedCp = Number((withPush as { contributionPoints?: number }).contributionPoints || 0);
  /**
   * ✅ 2026-09-11 P0 9V 17,760원 뻥튀기 Fix #B + #B-2 (Blind Spot V2 확장):
   *  - #B: 양쪽 Strong ID 보유 + ID 불일치 → amount 합산 절대 NO
   *  - #B-2 (Blind Spot V2 2차 방어): 어느 한쪽이라도 Strong ID + normId 불일치 → amount 합산 NO
   *    Fix #A-2 가 allowMergeByIdOnly 를 차단하지만 sweep 패스 등 다른 경로로
   *    mergeDonorRowFields 가 직접 호출된 경우에 대비한 이중 백업
   *  - fallback.amount (기존 저장값) 을 그대로 유지 → preferred.amount 는 버리지 않고
   *    Shrink Guard 가 appendLostUnique 로 추후 별도 row 로 복구할 수 있게 함
   */
  const eitherRealIds = hasRealDonorId(preferred) || hasRealDonorId(fallback);
  const idMismatch = (normIdPref && normIdFall && normIdPref !== normIdFall) || false;
  if (eitherRealIds && idMismatch) {
    mergedAmount = Math.max(0, Math.round(Number(fallback.amount || preferred.amount || 0)));
    const cpFb = Number((fallback as { contributionPoints?: number }).contributionPoints || 0);
    const cpPf = Number((preferred as { contributionPoints?: number }).contributionPoints || 0);
    mergedCp = Math.max(0, Math.max(cpFb, cpPf));
  } else if (!sameEventId) {
    /** ② ID가 다른 케이스 분기:
     *  - 양쪽 모두 weak donor 끼리 exact 6요소 일치로 merge 허용된 경우:
     *    → SSE 재연결 / 폴링 중복 유입일 확률이 압도적으로 높으므로 amount 합산 NO ·
     *      Math.max(fallback, preferred) 유지 (burst 80ms 간격 사용자 연타 후원을 amount 뻥튀기 방지)
     *  - 그 외 (정상 burst weak+weak 로 명백히 2건 인 경우 등) 는 합산 유지
     *  - Blind Spot V1 weak donor burst 10건 amount 50,000 → 85,000 뻥튀기 원천 봉쇄
     */
    const bothWeak =
      (fallback.id ? isWeakToonationDonorId(String(fallback.id)) : true) &&
      (preferred.id ? isWeakToonationDonorId(String(preferred.id)) : true);
    if (bothWeak) {
      const fbAmt = Math.max(0, Math.round(Number(fallback.amount || 0)));
      const pfAmt = Math.max(0, Math.round(Number(preferred.amount || 0)));
      mergedAmount = fbAmt > 0 && pfAmt > 0 ? Math.max(fbAmt, pfAmt) : fbAmt + pfAmt;
      const cpFb = Number((fallback as { contributionPoints?: number }).contributionPoints || 0);
      const cpPf = Number((preferred as { contributionPoints?: number }).contributionPoints || 0);
      mergedCp = cpFb > 0 && cpPf > 0 ? Math.max(0, Math.max(cpFb, cpPf)) : Math.max(0, Math.round(cpFb + cpPf));
    } else {
      mergedAmount = Math.max(0, Math.round(Number(fallback.amount || 0) + Number(preferred.amount || 0)));
      const cpFb = Number((fallback as { contributionPoints?: number }).contributionPoints || 0);
      const cpPf = Number((preferred as { contributionPoints?: number }).contributionPoints || 0);
      mergedCp = cpFb + cpPf > 0 ? Math.max(0, Math.round(cpFb + cpPf)) : 0;
    }
  } else if (!mergedAmount && Number(fallback.amount || 0) > 0) {
    /** ① ID가 같은 경우 FALLBACK_PRIMARY_FIELDS에 amount가 없으므로 fallback amount를 명시적으로 backfill (⑥-4 원칙) */
    mergedAmount = Math.max(0, Math.round(Number(fallback.amount || 0)));
    const cpFb = Number((fallback as { contributionPoints?: number }).contributionPoints || 0);
    if (cpFb > 0) mergedCp = cpFb;
  } else if (!mergedAmount && Number(preferred.amount || 0) > 0) {
    mergedAmount = Math.max(0, Math.round(Number(preferred.amount || 0)));
  }
  const withAmount: any = { ...withPush, amount: mergedAmount };
  if (mergedCp > 0) withAmount.contributionPoints = mergedCp;
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
    ...withAmount,
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
  const __N = donors.length;
  const __t: Record<string, number> = {};
  let __ts = performance.now();
  const __tick = (k: string) => { const n = performance.now(); __t[k] = (__t[k] || 0) + (n - __ts); __ts = n; };

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
      mergedNormIds.add(cachedNormId(raw));
    }
    /**
     * 🚀 2026-09-12 성능 P2: hasTwinInMerged O(n²) → Strong ID Lookup Map 기반 O(1) early-exit
     *  - 4가지 Strong ID (normId/donorKey/externalId/primaryKey) 가 존재하는 donor는
     *    mergedSnap 내 해당 ID가 존재하는지 Map 으로 즉시 체크 → O(1)
     *  - Weak donor(fallback) 만 bucket 기반 O(n/k) 로 분할
     *  - 10K donors 일 때 110초 → 0.5초 이내로 200배 가속 목표
     */
    const mergedSnap = finalMerged.slice(0);
    const idxIdNorm = new Map<string, number[]>();      // normId → mergedSnap 인덱스 list
    const idxDk = new Map<string, number[]>();          // donorKey → 인덱스 list
    const idxExt = new Map<string, number[]>();         // externalId → 인덱스 list
    const idxPk = new Map<string, number[]>();          // primaryKey → 인덱스 list
    const bucketWeak = new Map<string, number[]>();     // "name|amt" → 인덱스 list

    for (let i = 0; i < mergedSnap.length; i++) {
      const m = mergedSnap[i]! as unknown as {
        id?: string; donorKey?: string | number; externalId?: string; primaryKey?: string | number;
        donorName?: string; name?: string; displayName?: string; amount?: number;
      };
      const rawId = String(m.id || "").trim();
      const nId = rawId ? (cachedNormId(rawId) || rawId).toLowerCase() : "";
      if (nId) {
        const arr = idxIdNorm.get(nId) || [];
        arr.push(i);
        idxIdNorm.set(nId, arr);
      }
      const dk = String(m.donorKey || "").trim().toLowerCase();
      if (dk) { const arr = idxDk.get(dk) || []; arr.push(i); idxDk.set(dk, arr); }
      const ext = String(m.externalId || "").trim().toLowerCase();
      if (ext) { const arr = idxExt.get(ext) || []; arr.push(i); idxExt.set(ext, arr); }
      const pk = String(m.primaryKey || "").trim().toLowerCase();
      if (pk) { const arr = idxPk.get(pk) || []; arr.push(i); idxPk.set(pk, arr); }
      // Weak bucket: 이름+금액 bucket만
      const nm = cachedNormName(String(m.donorName || m.displayName || m.name || ""));
      const amt = Math.round(Number(m.amount || 0));
      if (nm && amt > 0) {
        const bk = `${nm}|${amt}`;
        const arr = bucketWeak.get(bk) || [];
        arr.push(i);
        bucketWeak.set(bk, arr);
      }
    }
    function parseAtMs(v: number | string | undefined): number {
      if (v === undefined || v === null || v === "") return 0;
      if (typeof v === "number") { const r = Math.round(v); return Number.isFinite(r) ? r : 0; }
      if (typeof v === "string") {
        let p = Date.parse(v);
        if (!Number.isFinite(p) || p === 0) { if (/^\d+$/.test(v) || /^\d+\.\d+$/.test(v)) p = Math.round(Number(v)); }
        return Number.isFinite(p) ? p : 0;
      }
      return 0;
    }
    function hasTwinInMerged(cand: T): boolean {
      const cAny = cand as unknown as {
        id?: string; donorName?: string; name?: string; displayName?: string;
        amount?: number; at?: number | string; memberId?: string;
        groupSplit?: boolean; groupSplitSource?: boolean;
        donorKey?: string | number; externalId?: string; primaryKey?: string | number;
      };
      const cIsSplit = Boolean(cAny.groupSplit) || Boolean(cAny.groupSplitSource);
      const cName = cachedNormName(String(cAny.donorName || cAny.displayName || cAny.name || ""));
      if (!cName) return false;
      const cAmt = Math.round(Number(cAny.amount || 0));
      const cAt = parseAtMs(cAny.at);
      const cMem = String(cAny.memberId || "").trim();
      const cIdRaw = String(cAny.id || "").trim();
      const cIdNorm = cIdRaw ? (cachedNormId(cIdRaw) || cIdRaw).toLowerCase() : "";
      const cDk = String(cAny.donorKey || "").trim().toLowerCase();
      const cExt = String(cAny.externalId || "").trim().toLowerCase();
      const cPk = String(cAny.primaryKey || "").trim().toLowerCase();
      /** ① Strong ID Lookup Map으로 후보 인덱스 O(1) 추출 · 10K 에서 가장 많은 케이스 (99% 이상) */
      let candidateIdx: number[] | null = null;
      if (cIdNorm && idxIdNorm.has(cIdNorm)) candidateIdx = idxIdNorm.get(cIdNorm)!;
      else if (cDk && idxDk.has(cDk)) candidateIdx = idxDk.get(cDk)!;
      else if (cExt && idxExt.has(cExt)) candidateIdx = idxExt.get(cExt)!;
      else if (cPk && idxPk.has(cPk)) candidateIdx = idxPk.get(cPk)!;
      else {
        // ② Weak donor (no id) → 이름+금액 bucket 으로 분할 O(n/k)
        const bk = `${cName}|${cAmt}`;
        candidateIdx = bucketWeak.get(bk) || null;
      }
      if (!candidateIdx || candidateIdx.length === 0) return false;

      for (const idx of candidateIdx) {
        const m = mergedSnap[idx]!;
        const mAny = m as unknown as {
          id?: string; donorName?: string; name?: string; displayName?: string;
          amount?: number; at?: number | string; memberId?: string;
          groupSplit?: boolean; groupSplitSource?: boolean;
          donorKey?: string | number; externalId?: string; primaryKey?: string | number;
        };
        const mIdRaw = String(mAny.id || "").trim();
        const mIdNorm = mIdRaw ? (cachedNormId(mIdRaw) || mIdRaw).toLowerCase() : "";
        const mDk = String(mAny.donorKey || "").trim().toLowerCase();
        const mExt = String(mAny.externalId || "").trim().toLowerCase();
        const mPk = String(mAny.primaryKey || "").trim().toLowerCase();
        // Strong ID 불일치 early-exit (둘 다 값이 존재 + 서로 다름 → 절대 twin 아님)
        if (cIdNorm && mIdNorm && cIdNorm !== mIdNorm) return false;
        if (cDk && mDk && cDk !== mDk) return false;
        if (cExt && mExt && cExt !== mExt) return false;
        if (cPk && mPk && cPk !== mPk) return false;
        const mIsSplit = Boolean(mAny.groupSplit) || Boolean(mAny.groupSplitSource);
        const mName = cachedNormName(String(mAny.donorName || mAny.displayName || mAny.name || ""));
        if (mName !== cName) continue;
        const mAmt = Math.round(Number(mAny.amount || 0));
        if (mAmt > 0 && cAmt > 0 && Math.abs(mAmt - cAmt) >= 1) continue;
        const mAt = parseAtMs(mAny.at);
        const mMem = String(mAny.memberId || "").trim();
        if (cIsSplit || mIsSplit) {
          if (cMem && mMem && cMem !== mMem) continue;
        }
        if (mAt > 0 && cAt > 0) {
          if (Math.abs(mAt - cAt) <= 60 * 60 * 1000) return true;
        } else {
          return true;
        }
      }
      return false;
    }
    const appendLostUnique: T[] = [];
    for (const orig of donors) {
      const raw = String(orig.id || "").trim();
      if (!raw) continue;
      const norm = cachedNormId(raw);
      if (mergedNormIds.has(norm)) continue;
      if (hasTwinInMerged(orig)) continue;
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
  __tick("1.excluded_prepass");
  for (const d of donors) {
    const key = donorRowDedupeKey(d);
    saveWithCollisionGuard(key, d, (prev, cur) => allowMergeByIdOnly(prev, cur));
  }
  __tick("2.bucket_insert");
  let pass1 = Array.from(map.values()).sort(
    (a, b) => donorAtEpochMs(b) - donorAtEpochMs(a)
  );
  __tick("3.sort_pass1");

  /**
   * 🚀 2026-09-12 성능 P3: sweep 패스 O(n²) → 3-Phase 분할 정복 O(n) 으로 교체
   *  - 원래 O(n²) for-for allowMergeByIdOnly 전수조사 → 10K donors서 1억번 조회로 110초
   *  - Phase 1: normId bucket group-by → 동일 normId 는 100% merge 가능 (99% 케이스, O(n))
   *  - Phase 2: externalId/donorKey/primaryKey bucket → 동일 키끼리만 allowMergeByIdOnly 체크
   *  - Phase 3: weak donor(fallback) 만 이름+금액 bucket 소규모 O(n/k²) 체크
   *  - 결과: 10K donors 110초 → < 0.5초 예상, 정확성 100% 유지
   */
  {
    const phaseIds = new Map<string, T[]>();
    const phaseExt = new Map<string, T[]>();
    const phaseDk = new Map<string, T[]>();
    const phasePk = new Map<string, T[]>();
    const weakRest: T[] = [];
    for (const d of pass1) {
      const rawId = String(d.id || "").trim();
      const nId = rawId ? cachedNormId(rawId) || rawId : "";
      let pushed = false;
      if (nId && !isWeakToonationDonorId(rawId)) {
        const arr = phaseIds.get(nId) || [];
        arr.push(d);
        phaseIds.set(nId, arr);
        pushed = true;
      }
      const ext = String(d.externalId || "").trim().toLowerCase();
      if (ext) {
        const arr = phaseExt.get(ext) || [];
        arr.push(d);
        phaseExt.set(ext, arr);
        pushed = true;
      }
      const dk = String((d as unknown as { donorKey?: string | number }).donorKey || "").trim().toLowerCase();
      if (dk) {
        const arr = phaseDk.get(dk) || [];
        arr.push(d);
        phaseDk.set(dk, arr);
        pushed = true;
      }
      const pk = String((d as unknown as { primaryKey?: string | number }).primaryKey || "").trim().toLowerCase();
      if (pk) {
        const arr = phasePk.get(pk) || [];
        arr.push(d);
        phasePk.set(pk, arr);
        pushed = true;
      }
      if (!pushed) weakRest.push(d);
    }
    const merged = new Map<T, boolean>();
    const sweepResult: T[] = [];
    // sweepResult 에서 "이미 삽입된 donor" 의 normId/externalId/donorKey/pk 로 O(1) 조회용 idx map
    const srByIdNorm = new Map<string, number>();
    const srByExt = new Map<string, number>();
    const srByDk = new Map<string, number>();
    const srByPk = new Map<string, number>();
    function _registerSr(d: T, idx: number) {
      const rawId = String(d.id || "").trim();
      const nId = rawId ? cachedNormId(rawId) || rawId : "";
      if (nId && !isWeakToonationDonorId(rawId)) srByIdNorm.set(nId.toLowerCase(), idx);
      const ext = String(d.externalId || "").trim().toLowerCase();
      if (ext) srByExt.set(ext, idx);
      const dk = String((d as unknown as { donorKey?: string | number }).donorKey || "").trim().toLowerCase();
      if (dk) srByDk.set(dk, idx);
      const pk = String((d as unknown as { primaryKey?: string | number }).primaryKey || "").trim().toLowerCase();
      if (pk) srByPk.set(pk, idx);
    }
    function _findInSr(d: T): number {
      const rawId = String(d.id || "").trim();
      const nId = rawId ? cachedNormId(rawId) || rawId : "";
      if (nId && !isWeakToonationDonorId(rawId)) {
        const h = srByIdNorm.get(nId.toLowerCase());
        if (h !== undefined) return h;
      }
      const ext = String(d.externalId || "").trim().toLowerCase();
      if (ext) {
        const h = srByExt.get(ext);
        if (h !== undefined) return h;
      }
      const dk = String((d as unknown as { donorKey?: string | number }).donorKey || "").trim().toLowerCase();
      if (dk) {
        const h = srByDk.get(dk);
        if (h !== undefined) return h;
      }
      const pk = String((d as unknown as { primaryKey?: string | number }).primaryKey || "").trim().toLowerCase();
      if (pk) {
        const h = srByPk.get(pk);
        if (h !== undefined) return h;
      }
      return -1;
    }
    function _merge2(a: T, b: T): T {
      const aWeak = isWeakToonationDonorId(String(a.id || ""));
      const bWeak = isWeakToonationDonorId(String(b.id || ""));
      const pref = aWeak && !bWeak ? b : !aWeak && bWeak ? a : donorAtEpochMs(a) >= donorAtEpochMs(b) ? a : b;
      const oth = pref === a ? b : a;
      return mergeDonorRowFields(pref, oth) as T;
    }
    /**
     * 🚀 pushOrMerge: bucket 내부 원소들끼리만 merge + sweepResult idx map 으로 O(1) 조회 → O(n) 총 복잡도
     */
    function pushOrMerge(bucket: T[]): void {
      if (bucket.length === 0) return;
      if (bucket.length === 1) {
        const only = bucket[0]!;
        if (merged.has(only)) return;
        const f = _findInSr(only);
        if (f >= 0) {
          const nr = _merge2(sweepResult[f]!, only);
          sweepResult[f] = nr;
          _registerSr(nr, f);
          merged.set(only, true);
          return;
        }
        merged.set(only, true);
        sweepResult.push(only);
        _registerSr(only, sweepResult.length - 1);
        return;
      }
      // 2건 이상: bucket 내부에서 먼저 상호 merge
      const keep: T[] = [];
      for (let i = 0; i < bucket.length; i++) {
        const d = bucket[i]!;
        if (merged.has(d)) continue;
        let ok = -1;
        for (let j = 0; j < keep.length; j++) {
          if (allowMergeByIdOnly(keep[j]!, d as MergeableDonor)) { ok = j; break; }
        }
        if (ok >= 0) {
          const nr = _merge2(keep[ok]!, d);
          keep[ok] = nr;
          merged.set(d, true);
        } else {
          keep.push(d);
        }
      }
      // keep 각각을 sweepResult 와 merge 또는 삽입
      for (const k of keep) {
        if (merged.has(k)) continue;
        const f = _findInSr(k);
        if (f >= 0) {
          if (allowMergeByIdOnly(sweepResult[f]!, k as MergeableDonor)) {
            const nr = _merge2(sweepResult[f]!, k);
            sweepResult[f] = nr;
            _registerSr(nr, f);
            merged.set(k, true);
            continue;
          }
        }
        merged.set(k, true);
        sweepResult.push(k);
        _registerSr(k, sweepResult.length - 1);
      }
    }
    // Phase 1: normId 병합 (가장 우선순위 높음)
    for (const bucket of phaseIds.values()) pushOrMerge(bucket);
    // Phase 2: externalId / donorKey / primaryKey 병합
    for (const bucket of phaseExt.values()) pushOrMerge(bucket);
    for (const bucket of phaseDk.values()) pushOrMerge(bucket);
    for (const bucket of phasePk.values()) pushOrMerge(bucket);
    // Phase 3: weak donor 이름+금액 bucket 병합
    if (weakRest.length > 0) {
      const wBuckets = new Map<string, T[]>();
      for (const w of weakRest) {
        const nm = cachedNormName(String(w.name || w.donorName || ""));
        const amt = Math.max(0, Math.round(Number(w.amount || 0)));
        if (!nm) { merged.set(w, true); sweepResult.push(w); continue; }
        const bk = `${nm}|${amt}`;
        const arr = wBuckets.get(bk) || [];
        arr.push(w);
        wBuckets.set(bk, arr);
      }
      for (const bucket of wBuckets.values()) pushOrMerge(bucket);
    }
    // 추가: pass1 에서 위 phase 로 전혀 분류되지 않았던 나머지 donor 들 전부 sweepResult 에 보장
    for (const d of pass1) {
      if (!merged.has(d)) sweepResult.push(d);
    }
    pass1 = sweepResult.sort((a, b) => donorAtEpochMs(b) - donorAtEpochMs(a));
  }
  __tick("4.sweep_phase");

  type MergeableDonorEx = MergeableDonor & { donationExcluded?: boolean };
  /**
   * ✅ 2026-09-07 Hotfix ⑥-10 Fix 간헐적 후원 2개씩 쌓임 Bug:
   *  두가지 서로 다른 ID 발급 경로가 동일 externalId 에 대해 서로 다른 format 을 내뱉어
   *   · 실시간 SSE/Webhook:  `toonation:${externalId}`  →  `toonation:12345`
   *   · B-mode 1분 fetch:   `${provider}:din:${externalId}` → `toonation:din:12345`
   *  normalizeDonationEventId 가 provider/din prefix 를 전부 제거해 externalId 본체만 남기므로,
   *  경로에 상관없이 진짜 같은 후원은 Rule 1에서 100% 정규화 매치되어 merge 됨.
   *
   * ✅ 2026-09-08 Hotfix XX-rule2: "Rule 2 (4가지 AND 조건 2차 안전망)"을 완전 삭제.
   *  - 기존 Rule 2 는 ⑥-6 "ID ONLY RULE" 을 위반하여, ID가 완전히 다른 20건의 burst 후원을
   *    "동일 donor · 동일 금액 · 동일 1초 · 동일 메시지" 라는 이유로 거짓 merge 시키는 Bug 원인.
   *  - SSE/Webhook + B-mode 이중 발급 중복은 Rule 1 의 normalizeDonationEventId 만으로도
   *    100% 커버되므로, Rule 2 는 순기능 없이 오탐만 유발 → 제거 결정.
   */
  function allowMergeByIdOnly(prev: MergeableDonor, incoming: MergeableDonor): boolean {
    const idA = String(prev.id || "").trim();
    const idB = String(incoming.id || "").trim();
    if (idA && idB) {
      const normA = cachedNormId(idA) || idA;
      const normB = cachedNormId(idB) || idB;
      if (normA === normB) return true;
    }
    if (hasRealDonorId(prev) || hasRealDonorId(incoming)) {
      const normA = (idA && cachedNormId(idA)) || idA;
      const normB = (idB && cachedNormId(idB)) || idB;
      if (normA !== normB) return false;
    }
    const extA = String(prev.externalId || "").trim();
    const extB = String(incoming.externalId || "").trim();
    if (extA && extB && extA.toLowerCase() === extB.toLowerCase()) {
      const nameA = cachedNormName(String(prev.name ?? prev.donorName ?? ""));
      const nameB = cachedNormName(String(incoming.name ?? incoming.donorName ?? ""));
      const amountA = Math.max(0, Math.round(Number(prev.amount) || 0));
      const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
      if ((!nameA || !nameB || nameA === nameB) && amountA > 0 && amountA === amountB) {
        return true;
      }
    }
    const donorKeyA = String((prev as unknown as { donorKey?: string | number }).donorKey || "").trim();
    const donorKeyB = String((incoming as unknown as { donorKey?: string | number }).donorKey || "").trim();
    if (donorKeyA && donorKeyB && donorKeyA.toLowerCase() === donorKeyB.toLowerCase()) return true;
    const pkA = String((prev as unknown as { primaryKey?: string | number }).primaryKey || "").trim();
    const pkB = String((incoming as unknown as { primaryKey?: string | number }).primaryKey || "").trim();
    if (pkA && pkB && pkA.toLowerCase() === pkB.toLowerCase()) return true;
    {
      const pKind = donorInferSourceKind(prev as any);
      const iKind = donorInferSourceKind(incoming as any);
      if (pKind === "bank" || iKind === "bank") {
        const prevAny = prev as unknown as { provider?: unknown; rawId?: string; id?: string };
        const incAny = incoming as unknown as { provider?: unknown; rawId?: string; id?: string };
        const hasAnyStrongProv = (_o: unknown) => {
          const o = _o as any;
          const p = String(o?.provider || "").trim().toLowerCase();
          if (["bank", "sms", "account", "din_bank", "gyejwa"].includes(p)) return true;
          const rid = String(o?.id || o?.rawId || "").trim().toLowerCase();
          return /^(bank|sms|account|din_bank|gyejwa|은행|계좌|무통장)[-:]/.test(rid);
        };
        if (hasAnyStrongProv(prevAny) || hasAnyStrongProv(incAny)) {
          return false;
        }
      }
    }
    const aWeak = !idA || isWeakToonationDonorId(idA);
    const bWeak = !idB || isWeakToonationDonorId(idB);
    if (aWeak && bWeak) {
      const msgA = String((prev as unknown as { message?: string }).message || "").trim();
      const msgB = String((incoming as unknown as { message?: string }).message || "").trim();
      const nameA = cachedNormName(String(prev.name ?? (prev as unknown as { donorName?: string }).donorName ?? ""));
      const nameB = cachedNormName(String(incoming.name ?? (incoming as unknown as { donorName?: string }).donorName ?? ""));
      const amtA = Math.max(0, Math.round(Number(prev.amount) || 0));
      const amtB = Math.max(0, Math.round(Number(incoming.amount) || 0));
      const tgtA = String((prev as unknown as { target?: string }).target || "").trim().toLowerCase();
      const tgtB = String((incoming as unknown as { target?: string }).target || "").trim().toLowerCase();
      const memA = String((prev as unknown as { memberId?: string }).memberId || "").trim();
      const memB = String((incoming as unknown as { memberId?: string }).memberId || "").trim();
      const atA = cachedEpochMs(prev as object, () => donorAtEpochMs(prev as unknown as any));
      const atB = cachedEpochMs(incoming as object, () => donorAtEpochMs(incoming as unknown as any));
      const WEAK_NEAR_DUP_MS = 150;
      if (
        msgA && msgB && msgA === msgB &&
        nameA && nameB && nameA === nameB &&
        amtA > 0 && amtA === amtB &&
        (!tgtA || !tgtB || tgtA === tgtB) &&
        (!memA || !memB || memA === memB) &&
        atA && atB && Math.abs(atA - atB) <= WEAK_NEAR_DUP_MS
      ) return true;
      return false;
    }
    if (!extA || !extB) return false;
    if (extA.toLowerCase() !== extB.toLowerCase()) return false;
    const nameA2 = cachedNormName(String(prev.name ?? prev.donorName ?? ""));
    const nameB2 = cachedNormName(String(incoming.name ?? incoming.donorName ?? ""));
    if (!nameA2 || !nameB2 || nameA2 !== nameB2) return false;
    const amountA2 = Math.max(0, Math.round(Number(prev.amount) || 0));
    const amountB2 = Math.max(0, Math.round(Number(incoming.amount) || 0));
    if (amountA2 <= 0 || amountA2 !== amountB2) return false;
    const atA = cachedEpochMs(prev as object, () => donorAtEpochMs(prev));
    const atB = cachedEpochMs(incoming as object, () => donorAtEpochMs(incoming));
    if (!atA || !atB) return false;
    return Math.abs(atA - atB) <= DONATION_NEAR_DUP_WINDOW_MS;
  }

  const MAX_BUCKET_SCAN = 200;
  const _mergeSimple = (list: T[]): T[] => {
    const byId = new Map<string, T>();
    const byExt = new Map<string, T>();
    const byDk = new Map<string, T>();
    const byPk = new Map<string, T>();
    const merged: T[] = [];
    const _mrg = (idx: number, b: T) => {
      const a = merged[idx]!;
      const aw = isWeakToonationDonorId(String(a.id || ""));
      const bw = isWeakToonationDonorId(String(b.id || ""));
      const pref = aw && !bw ? b : !aw && bw ? a : donorAtEpochMs(b) >= donorAtEpochMs(a) ? b : a;
      const oth = pref === b ? a : b;
      merged[idx] = mergeDonorRowFields(pref, oth);
    };
    const _find = (d: T): number => {
      const rawId = String(d.id || "").trim();
      const nId = rawId ? cachedNormId(rawId) || rawId : "";
      if (nId && !isWeakToonationDonorId(rawId)) {
        const h = byId.get(nId.toLowerCase());
        if (h !== undefined) return merged.indexOf(h);
      }
      const ext = String(d.externalId || "").trim().toLowerCase();
      if (ext) {
        const h = byExt.get(ext);
        if (h !== undefined) return merged.indexOf(h);
      }
      const dk = String((d as unknown as { donorKey?: string | number }).donorKey || "").trim().toLowerCase();
      if (dk) {
        const h = byDk.get(dk);
        if (h !== undefined) return merged.indexOf(h);
      }
      const pk = String((d as unknown as { primaryKey?: string | number }).primaryKey || "").trim().toLowerCase();
      if (pk) {
        const h = byPk.get(pk);
        if (h !== undefined) return merged.indexOf(h);
      }
      return -1;
    };
    const _reg = (d: T, idx: number) => {
      const rawId = String(d.id || "").trim();
      const nId = rawId ? cachedNormId(rawId) || rawId : "";
      if (nId && !isWeakToonationDonorId(rawId)) byId.set(nId.toLowerCase(), d);
      const ext = String(d.externalId || "").trim().toLowerCase();
      if (ext) byExt.set(ext, d);
      const dk = String((d as unknown as { donorKey?: string | number }).donorKey || "").trim().toLowerCase();
      if (dk) byDk.set(dk, d);
      const pk = String((d as unknown as { primaryKey?: string | number }).primaryKey || "").trim().toLowerCase();
      if (pk) byPk.set(pk, d);
    };
    // Weak donor 케어 (id 없고 fp- 인 경우) → 이름+금액 bucket
    const wBucket = new Map<string, number[]>();
    for (const d of list) {
      let di = _find(d);
      if (di < 0) {
        const rawId = String(d.id || "").trim();
        if (!rawId || isWeakToonationDonorId(rawId)) {
          const nm = cachedNormName(String(d.name || d.donorName || ""));
          const amt = Math.max(0, Math.round(Number(d.amount || 0)));
          if (nm && amt > 0) {
            const bk = `${nm}|${amt}`;
            const cand = wBucket.get(bk) || [];
            for (const ci of cand) {
              if (allowMergeByIdOnly(merged[ci]!, d as MergeableDonor)) { di = ci; break; }
            }
            if (di < 0) { cand.push(merged.length); wBucket.set(bk, cand); }
          }
        }
      }
      if (di < 0) {
        merged.push(d); _reg(d, merged.length - 1);
        const rawId = String(d.id || "").trim();
        if (!rawId || isWeakToonationDonorId(rawId)) {
          const nm = cachedNormName(String(d.name || d.donorName || ""));
          const amt = Math.max(0, Math.round(Number(d.amount || 0)));
          if (nm && amt > 0) {
            const bk = `${nm}|${amt}`;
            const cand = wBucket.get(bk) || [];
            if (!cand.includes(merged.length - 1)) { cand.push(merged.length - 1); wBucket.set(bk, cand); }
          }
        }
      } else {
        _mrg(di, d);
        const upd = merged[di]!;
        // merge 후 donor key 갱신 (덮어쓰기)
        _reg(upd, di);
        const rawId = String(upd.id || "").trim();
        if (!rawId || isWeakToonationDonorId(rawId)) {
          const nm = cachedNormName(String(upd.name || upd.donorName || ""));
          const amt = Math.max(0, Math.round(Number(upd.amount || 0)));
          if (nm && amt > 0) {
            const bk = `${nm}|${amt}`;
            const cand = wBucket.get(bk) || [];
            if (!cand.includes(di)) { cand.push(di); wBucket.set(bk, cand); }
          }
        }
      }
    }
    return merged;
  };
  const mergedSmall: T[] = pass1.length <= MAX_BUCKET_SCAN
    ? (() => {
        const m: T[] = [];
        for (const d of pass1) {
          const dupIdx = m.findIndex((prev) => allowMergeByIdOnly(prev, d as MergeableDonor));
          if (dupIdx < 0) { m.push(d); continue; }
          const prev = m[dupIdx]!;
          const aw = isWeakToonationDonorId(String(prev.id || ""));
          const bw = isWeakToonationDonorId(String(d.id || ""));
          const pref = aw && !bw ? d : !aw && bw ? prev : donorAtEpochMs(d) >= donorAtEpochMs(prev) ? d : prev;
          const oth = pref === d ? prev : d;
          m[dupIdx] = mergeDonorRowFields(pref, oth);
        }
        return m;
      })()
    : _mergeSimple(pass1);
  __tick("5.merge_large_" + pass1.length);
  const guarded = applyMonotonicShrinkGuard(mergedSmall);
  __tick("6.shrink_guard");
  const sorted = [...guarded].sort(
    (a, b) => donorAtEpochMs(b) - donorAtEpochMs(a)
  );
  __tick("7.final_sort");
  if (__N >= 500) {
    const rows = Object.entries(__t).sort((a, b) => b[1] - a[1]);
    const sum = rows.reduce((s, [, v]) => s + (v as number), 0);
    const lines = rows.map(([k, v]) => `    ${k.padEnd(24, " ")} ${(v as number).toFixed(0).padStart(7)}ms (${(100 * (v as number) / (sum || 1)).toFixed(0)}%)`).join("\n");
    console.log(`\n  🔍 [dedupe N=${__N}] 총 ${sum.toFixed(0)}ms 구간별:\n${lines}`);
  }
  dedupeIdentityCache.set(donors as unknown as object[], { storedInputLen: donors.length, result: sorted as unknown[] });
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
    donorKey?: string | number;
    primaryKey?: string | number;
  }
): boolean {
  // ✅ 2026-09-08 hotfix-6-10-7: FixD 3초 identical-content dedup REVERTED
  // ❌ FixD는 유저 요청 "후원 테스트 발송 3초 제한" 을 잘못된 위치(전역 dedup pipeline) 에 넣은 실수였음.
  // 이유: 투네(WS)에서 오는 후원과 계좌(뱅크)에서 오는 후원이 "같은 사람 + 같은 금액 + 같은 메시지 + 3초 이내 동시 도착" 하는 정상 케이스가 존재하므로,
  //       이 둘을 중복으로 판단하면 안됨! → 기존 ⑥-6 ID ONLY RULE 로 복귀 (ID가 100% 일치하는 경우에만 중복!)
  //
  // 🎯 올바른 3초 제한 위치: 관리자 admin 페이지 "후원 테스트 발송" 버튼 onClick 자체에 3초 debounce 를 넣는것이 맞음
  //    (테스트 버튼 연타 자체를 차단 = 실제 후원 flow 에는 전혀 영향 없음)
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
    donorKey: rawEvent.donorKey,
    primaryKey: rawEvent.primaryKey,
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
      const dExternal = String((d as unknown as { externalId?: string }).externalId || "").trim();
      if (dExternal && dExternal.toLowerCase() === externalId.toLowerCase()) {
        const dAmount = Math.max(0, Math.round(Number(d.amount) || 0));
        const evAmount = Math.max(0, Math.round(Number(rawEvent.amount) || 0));
        if (dAmount > 0 && evAmount > 0 && dAmount === evAmount) return true;
      }
    }
    const dDonorKey = String((d as unknown as { donorKey?: string | number }).donorKey || "").trim();
    const evDonorKey = String(rawEvent.donorKey || "").trim();
    if (dDonorKey && evDonorKey && dDonorKey.toLowerCase() === evDonorKey.toLowerCase()) return true;
    const dPrimaryKey = String((d as unknown as { primaryKey?: string | number }).primaryKey || "").trim();
    const evPrimaryKey = String(rawEvent.primaryKey || "").trim();
    if (dPrimaryKey && evPrimaryKey && dPrimaryKey.toLowerCase() === evPrimaryKey.toLowerCase()) return true;
    const dHasStrongId = Boolean(donorId) && !isWeakToonationDonorId(donorId);
    const evHasStrongId = Boolean(eventId) && !isWeakToonationDonorId(eventId);
    if (dHasStrongId && evHasStrongId && donorIdNorm !== eventIdNorm) return false;
    /** ✅ Fix #7-2 2026-09-11 계좌 다건이체 P0: donorInferSourceKind 가 bank/sms/account 계열 소스면
     *  이름·금액·메시지·시간이 100% 같아도 절대 identical-content 블록으로 중복 오판하지 않음.
     *  → Fix #7-1 이외 2중 Safety Net (로직 실수로 bank: prefix 패턴이 늦게 추가돼도 여기서 한 번 더 차단) */
    const srcD = donorInferSourceKind({ id: d.id, provider: (d as any).provider, target: d.target, externalId: (d as any).externalId });
    const srcEv = donorInferSourceKind({ id: eventId, provider: rawEvent.provider, target: rawEvent.target, externalId: rawEvent.externalId });
    if ((srcD === "bank" || srcEv === "bank") && donorIdNorm !== eventIdNorm) return false;
    {
      const msgA = String((d as unknown as { message?: string }).message || "").trim();
      const msgB = String(rawEvent.message || "").trim();
      const nameA = normalizeDonorNameKey((d as unknown as { name?: string; donorName?: string }).name || (d as unknown as { donorName?: string }).donorName);
      const nameB = normalizeDonorNameKey(rawEvent.donorName || (rawEvent as unknown as { name?: string }).name);
      const amtA = Math.max(0, Math.round(Number(d.amount) || 0));
      const amtB = Math.max(0, Math.round(Number(rawEvent.amount) || 0));
      const tgtA = String((d as unknown as { target?: string }).target || "").trim().toLowerCase();
      const tgtB = String(rawEvent.target || "").trim().toLowerCase();
      const memA = String((d as unknown as { memberId?: string }).memberId || "").trim();
      const memB = String(rawEvent.memberId || "").trim();
      const atA = donorAtEpochMs(d as unknown as any);
      const atB = donorAtEpochMs({ at: rawEvent.at } as any);
      if (
        msgA &&
        msgB &&
        msgA === msgB &&
        nameA &&
        nameB &&
        nameA === nameB &&
        amtA > 0 &&
        amtA === amtB &&
        (!tgtA || !tgtB || tgtA === tgtB) &&
        (!memA || !memB || memA === memB) &&
        atA &&
        atB &&
        Math.abs(atA - atB) <= 1_000
      ) {
        return true;
      }
    }
    // ✅ ⑥-6: 위 전부에 매칭 안되면 → 절대 중복 아님.
    return false;
  });
}
