import { applyMealBattleDonationToParticipants, mealBattleUsesRawDonationScore } from "@/lib/meal-battle-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { normalizeAnonymousDonorDisplayName } from "@/lib/donation/anonymous-donor-name";
import { resolveEffectiveDonorTarget } from "@/lib/state";
import {
  isDonationAmountEligibleForHighSocietyTerritory,
  isDonorHsTerritoryIncluded,
  normalizeHighSocietySettings,
  resolveSystemMiddlePushDir,
  syncHighSocietyMemberWidthSnapshotInState,
} from "@/lib/high-society";
import type { AppState, Donor, Member, ContributionFormula, ContributionLog } from "@/types";
import {
  computeContributionPoints,
  normalizeContributionFormula,
} from "@/lib/contribution-formula";
import {
  extractReliableToonationExtFromDonorId,
  isReliableToonationExternalId,
} from "./toonation/parse-event";
import { SAME_TOONATION_EVENT_NEAR_DUP_MS, DONATION_IDENTICAL_MESSAGE_NEAR_DUP_MS, CROSS_SOURCE_NEAR_DUP_MS, BANK_RESEND_NEAR_DUP_MS } from "./donation-dedupe-keys";
import { mapToMember } from "./mapper";
import type { DonationEvent, DonorAlias } from "./types";

function toEpochMs(input: string): number {
  const ts = Date.parse(input);
  return Number.isFinite(ts) ? ts : Date.now();
}

export type ApplyDonationResult =
  | { ok: true; state: AppState; event: DonationEvent }
  | { ok: false; reason: "unmatched" | "duplicate" | "paused"; event: DonationEvent };

/** 큐 검토용 `::review` 접미사 제거 */
export function normalizeDonationEventId(id: string): string {
  return String(id || "").replace(/::review$/i, "");
}

/** parse-event fallback id — 동일 후원이 다른 id로 두 번 들어올 수 있음
 *  ★ custom prefix (seq-X / don-real-X / don-X / 임의 str-{n} 등) 도 "UUID가 아닌 문자열 id = 신뢰 불가능 weak id" 로 분류 →
 *    donorRowDedupeKey seed hash 개별 키 생성 + shouldTreat ④ Weak bypass guard 타도록 유도 → 3·5연속 후원 개별 유지 */
export function isWeakToonationDonorId(id: string): boolean {
  const base = normalizeDonationEventId(String(id || "").trim()).replace(/^toonation:/i, "");
  if (!base) return false;
  if (/^(fp-|test-|toon-|seq-|don-|stub-|mock-)/i.test(base)) return true;
  if (/^\d{10,13}-\d+(-\d+-[a-z0-9]+)?$/i.test(base)) return true;
  /** UUID(표준하이픈형·32hex)는 reliable로 분류 → weak 아님 */
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) return false;
  if (/^[0-9a-f]{32}$/i.test(base)) return false;
  /** 그 외 문자열 기반 커스텀 id = 전부 weak로 분류 */
  return true;
}

/** donors·순위·멤버 합계 공통 — epoch ms (병합·정렬) */
export function donorAtEpochMs(donor: { at?: number | string }): number {
  const raw = donor.at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** donors·순위·멤버 합계 공통 — 동일 투네 externalId(또는 review 접미사) 1건만 */
export function donorRowDedupeKey(donor: {
  id?: string;
  name?: string;
  amount?: number;
  at?: number | string;
  message?: string;
  externalId?: string;
  rawHash?: string | number;
  groupSplit?: boolean;
  groupSplitSource?: boolean;
  memberId?: string;
  donationExcluded?: boolean;
}): string {
  const rawId = String(donor.id || "").trim();
  const baseId = normalizeDonationEventId(rawId);
  const isSplitPart = Boolean(donor.groupSplit) || baseId.includes(":split:");
  const isSplitSource = Boolean(donor.groupSplitSource);
  /**
   * ★ 단체짠 나누기 스플릿 파트 donor·소스 donor dedup bypass guard:
   *  groupSplit 파트 donor 는 `{sourceId}:split:{memberId}`를 키 맨 앞에 강제 삽입 →
   *  donorName·메시지·금액·at 이 모두 같아도 memberId가 다르면 각기 다른 key → 5행 2000원 씩 전부 유지.
   *  groupSplitSource donor(원본 1만원 제외라벨)는 ::src 접미사로 파트 donor 들과 절대 병합 안됨.
   */
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
    /**
     * ★ 3연속 후원 dedup aggressive 버그 FIX:
     *  weak fallback id(`fp-{ts}-{amount}` 또는 `{ts}-{amount}`)는
     *  1초 내 동일 금액 3건 발송시 ts·amount가 같아 3건 = 동일 key → 1건 병합 drop 됨.
     *  externalId(허브에서 준 UUID) 또는 임의 hash suffix(`rawHash`)를 붙여서
     *  "같은 금액 3연속 = 각기 다른 key" 로 보장 → pass1 1단계 dedup에서 3건 전부 유지.
     */
    const rawExt = String(donor.externalId || "").trim();
    const seed = rawExt || String(donor.rawHash || "").trim();
    if (seed) {
      const seedHash = Math.abs(Array.from(seed).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0x9e3779b9)).toString(36).padStart(7, "0").slice(-7);
      return `id:${baseId}#${seedHash}`;
    }
    return `id:${baseId}`;
  }
  if (baseId) return `id:${baseId}`;
  const name = String(donor.name || "").trim();
  const amount = Math.floor(Number(donor.amount || 0));
  const rawFallbackExt = String(donor.externalId || donor.rawHash || "").trim();
  if (rawFallbackExt) {
    const fallbackHash = Math.abs(Array.from(rawFallbackExt).reduce((acc, ch) => (acc * 131 + ch.charCodeAt(0)) | 0, 0xdeadbeef)).toString(36).padStart(6, "0").slice(-5);
    return `fallback:${name}|${donorAtEpochMs(donor)}|${amount}|${fallbackHash}`;
  }
  /**
   * ★ 3연속 후원 weak fallback path 최후 보루:
   *  externalId·rawHash 둘 다 비어있고 donor.name·amount·at 이 3건 모두 동일해도,
   *  원본 rawId 문자열 자체가 다르면 (서로 다른 후원이므로) 반드시 다른 key를 반환해야 pass1 에서 1건으로 병합되는 사태 방지.
   *  🔴 절대 Math.random() 사용 금지: 동일 donor 객체를 재호출 할 때 마다 key가 바뀌어서 동일 후원 1건이 N건으로 쌓여 총합 부풀려지는 "증가 버그" 유발.
   *  rawId 있으면 rawId hash 6자 고정 → rawId 없을 때만 name|at|amount 전체를 hash seed로 써서 항상 결정적 key 유지
   */
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

/** 후원 합산(멤버·순위·식대전)에서 제외할 행 */
export function isDonorExcludedFromDonationTotals(donor: {
  donationExcluded?: boolean;
}): boolean {
  return donor.donationExcluded === true;
}

/** 동일 id 병합 시 message·단체짠 플래그 등 선택 필드가 비는 쪽을 보완 */
export function mergeDonorRowFields<
  T extends {
    amount?: number;
    message?: string;
    name?: string;
    target?: string;
    donorName?: string;
    externalId?: string;
    rawHash?: string | number;
    id?: string;
    provider?: string;
    donationExcluded?: boolean;
    hsTerritoryExcluded?: boolean;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
    hsPushDir?: "left" | "right" | "split";
  },
>(preferred: T, fallback?: T | null): T {
  if (!fallback) return preferred;
  /**
   * ★ 근본 뿌리 FIX: donor 병합 시 어느 쪽 name/target을 쓸지 결정 → donorInferSourceKind 신뢰도 순위로 결정.
   *   - toonation 경로 donor = 실제 투네 후원 = 정확한 donorName (박자키) + target=투네 를 가지고 있을 확률 100%
   *   - bank 경로 donor = id 접두사 기반 오판 = 기본 이름 "후원" / target "계좌" 로 퉁쳐져 나올 확률 높음
   *   => 신뢰도 `toonation > other > bank` 순으로 높은 쪽 donor의 name/target 필드를 그대로 사용.
   *   두 경로 신뢰도가 같을 때 (둘 다 toonation 또는 둘 다 bank) 만 이름 길이 긴 쪽을 우선 사용.
   */
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
        : (String(preferred.name || preferred.donorName || "").length >= String(fallback.name || fallback.donorName || "").length);
  const bestNameSrc: T = usePrefForMeta ? preferred : fallback;
  const bestTargetSrc: T = usePrefForMeta ? preferred : fallback;
  const mergedName = String(bestNameSrc.name || bestNameSrc.donorName || preferred.name || preferred.donorName || fallback.name || fallback.donorName || "").trim() || undefined;
  const rawPrefTarget = String(preferred.target || "").trim();
  const rawFallTarget = String(fallback.target || "").trim();
  const targetPref = rawPrefTarget || bestTargetSrc.target;
  const mergedTarget = targetPref ? String(targetPref).trim() : (rawFallTarget || undefined);

  const msg = String(preferred.message || "").trim();
  const fallbackMsg = String(fallback.message || "").trim();
  const baseMerge = { ...preferred, name: mergedName ?? preferred.name, target: mergedTarget ?? preferred.target };
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
            : undefined;
  return {
    ...withPush,
    ...(preferred.donationExcluded || fallback.donationExcluded ? { donationExcluded: true as const } : {}),
    ...(territoryFlag === true
      ? { hsTerritoryExcluded: true as const }
      : territoryFlag === false
        ? { hsTerritoryExcluded: false as const }
        : {}),
    ...(preferred.groupSplit || fallback.groupSplit ? { groupSplit: true as const } : {}),
    ...(preferred.groupSplitSource || fallback.groupSplitSource ? { groupSplitSource: true as const } : {}),
  };
}

/** 🔥 dedupeDonorRows identity memo (동일 배열 ref 반복시 즉시 반환)
 *  merge·repair·sync 7~11회 중복 호출시 O(N²) 23,409회 비교 전면 스킵
 *  WeakMap 기반: GC 자동 추적 · 메모리 누수 0
 *  ✅ length safety: in-place push로 길이 변하면 storedInputLen 비교 → 자동 무효화
 */
type DedupeCacheEntry<T> = { storedInputLen: number; result: T[] };
const dedupeIdentityCache = new WeakMap<object[], DedupeCacheEntry<unknown>>();

export function dedupeDonorRows<
  T extends {
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
  },
>(donors: T[]): T[] {
  if (donors.length === 0) return donors;
  const entry = dedupeIdentityCache.get(donors as unknown as object[]) as DedupeCacheEntry<T> | undefined;
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
  const pass1 = Array.from(map.values()).sort((a, b) => donorAtEpochMs(b) - donorAtEpochMs(a));

  const MAX_BUCKET_SCAN = 200;
  if (pass1.length <= MAX_BUCKET_SCAN) {
    const merged: T[] = [];
    for (const d of pass1) {
      const dupIdx = merged.findIndex((prev) =>
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
        aWeak && !bWeak ? d : !aWeak && bWeak ? prev : donorAtEpochMs(d) >= donorAtEpochMs(prev) ? d : prev;
      const other = preferred === d ? prev : d;
      merged[dupIdx] = mergeDonorRowFields(preferred, other);
    }
    dedupeIdentityCache.set(donors as unknown as object[], { storedInputLen: donors.length, result: merged as unknown[] });
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
      aWeak && !bWeak ? d : !aWeak && bWeak ? prev : donorAtEpochMs(d) >= donorAtEpochMs(prev) ? d : prev;
    const other = preferred === d ? prev : d;
    merged[dupIdx] = mergeDonorRowFields(preferred, other);
  }
  dedupeIdentityCache.set(donors as unknown as object[], { storedInputLen: donors.length, result: merged as unknown[] });
  return merged;
}

/** 후원 기록 삭제 시 투네 대기 큐에서 함께 제거할 id 후보 */
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

/** 합산에 포함되는 후원 행 금액 합 — donationExcluded 제외 */
export function countableDonorTotal(donors: Donor[] | undefined): number {
  return dedupeDonorRows(donors || [])
    .filter((d) => !isDonorExcludedFromDonationTotals(d))
    .reduce((sum, d) => sum + Math.max(0, Math.round(Number(d.amount) || 0)), 0);
}

/** 후원 memberId 가 로스터에 얼마나 매칭되는지(금액 합) */
export function rosterDonorMatchScore(
  members: Member[] | null | undefined,
  donors: Donor[] | null | undefined
): number {
  const ids = new Set((members || []).map((m) => String(m.id || "").trim()).filter(Boolean));
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

/** 후원자 리스트(donors) 기준으로 멤버 계좌·투네 합계가 어긋날 때 보정.
 * 단, 의도적 멤버 추가·삭제(id 집합이 바뀐 최신 로스터)는 donors 가 옛 id 를 가리켜도
 * 폴백 로스터로 되돌리지 않는다. */
export function repairMemberTotalsForDonorRoster(
  state: AppState,
  ...fallbacks: Array<AppState | null | undefined>
): AppState {
  const donors = state.donors || [];
  const countable = countableDonorTotal(donors);
  if (countable <= 0) return state;

  const currentScore = rosterDonorMatchScore(state.members, donors);
  if (currentScore >= countable * 0.99) return state;

  /** 🔥 Phase2 rosterVersion O(1) 가드: 의도적 멤버 개편(bump됨) → repair 전체 skip
   *  state.rosterVersion 이 모든 폴백보다 크면 → 의도적 roster 변경의 과도 상태로 donor가 옛 id를 가리키는 것일 뿐.
   *  폴백 기준으로 member rollback 하지 않고 그대로 유지 (reassign이 뒤따라 올 예정)
   */
  const bumpedRoster = Number(state.rosterVersion || 0);
  if (bumpedRoster > 0) {
    const maxFbRoster = fallbacks.reduce((m, fb) => Math.max(m, Number(fb?.rosterVersion || 0)), 0);
    if (bumpedRoster > maxFbRoster) return state;
  }

  /** 🔥 개선A: fallbacks 없으면 폴백 후보가 0개 → 굳이 O(D·M) 매칭 없이 syncMemberTotals(state) 1회로 donors기반 재계산
   *  수학적 동치성: 함수 맨 아래 return sync( {..., members: bestMembers} ) 이므로
   *  bestMembers === state.members 일 때 결과는 완전히 sync(state) 와 동일.
   */
  if (fallbacks.length === 0) {
    return syncMemberTotalsFromDonors(state);
  }

  const stateIdSig = memberRosterIdSignature(state.members);
  const stateUpdatedAt = Number(state.updatedAt || 0);

  let bestMembers = state.members;
  let bestScore = currentScore;
  for (const fb of fallbacks) {
    if (!fb?.members?.length) continue;
    const fbIdSig = memberRosterIdSignature(fb.members);
    if (
      stateIdSig &&
      fbIdSig &&
      stateIdSig !== fbIdSig &&
      stateUpdatedAt >= Number(fb.updatedAt || 0)
    ) {
      continue;
    }
    const score = rosterDonorMatchScore(fb.members, donors);
    if (score > bestScore) {
      bestScore = score;
      bestMembers = fb.members;
    }
  }
  if (bestScore <= 0) return state;
  if (bestMembers === state.members || bestScore === currentScore) return state;
  return syncMemberTotalsFromDonors({ ...state, members: bestMembers });
}

function memberRosterIdSignature(members: Member[] | null | undefined): string {
  return (members || [])
    .map((m) => String(m.id || ""))
    .filter(Boolean)
    .sort()
    .join("\u001e");
}

/** 로스터에서 빠진 memberId 의 후원 행 제거 — 합산·zero-wipe 판단용(멤버 삭제 시 donors 유지 정책) */
export function purgeDonorsForMemberRoster(
  donors: Donor[] | undefined,
  members: Member[] | undefined
): Donor[] {
  const keep = new Set(
    (members || []).map((m) => String(m.id || "").trim()).filter(Boolean)
  );
  if (keep.size === 0) return [];
  return (donors || []).filter((d) => keep.has(String(d.memberId || "").trim()));
}

/** donors contributionPoints + 기여도 기록부 수동분 → 멤버 기여도 합 */
export function resolveMemberContributionTotal(
  memberId: string,
  state: Pick<AppState, "donors" | "contributionLogs" | "contributionFormula">
): number {
  const id = String(memberId || "").trim();
  if (!id) return 0;
  const formula = normalizeContributionFormula(state.contributionFormula);
  let fromDonors = 0;
  for (const donor of dedupeDonorRows(state.donors || [])) {
    if (isDonorExcludedFromDonationTotals(donor)) continue;
    if (String(donor.memberId || "").trim() !== id) continue;
    const stored = Number(donor.contributionPoints);
    if (Number.isFinite(stored) && stored >= 0) {
      fromDonors += Math.round(stored);
    } else {
      fromDonors += computeContributionPoints(
        donor.amount,
        donor.target || "account",
        formula
      );
    }
  }
  let fromLogs = 0;
  for (const log of state.contributionLogs || []) {
    if (String(log.memberId || "").trim() !== id) continue;
    const amt = Math.max(0, Math.floor(Number(log.amount) || 0));
    if (amt <= 0) continue;
    fromLogs += log.delta === -1 ? -amt : amt;
  }
  return Math.max(0, fromDonors + fromLogs);
}

/** ingest·toona 허브 계산식을 state에 병합하고 단건 기여도 점수를 결정 */
export function resolveApplyContributionContext(
  state: Pick<AppState, "contributionFormula">,
  event: Pick<DonationEvent, "contributionFormula" | "contributionPoints">,
  amount: number,
  target: "account" | "toon"
): { formula: ContributionFormula; contributionPoints: number } {
  const formula = normalizeContributionFormula(
    event.contributionFormula ?? state.contributionFormula
  );
  const override = Math.round(Number(event.contributionPoints));
  const contributionPoints =
    Number.isFinite(override) && override >= 0
      ? override
      : computeContributionPoints(amount, target, formula);
  return { formula, contributionPoints };
}

/** apply 직전 — 이벤트·toona 허브 계산식을 state에 반영 */
export function mergeContributionFormulaIntoState(
  state: AppState,
  event?: Pick<DonationEvent, "contributionFormula"> | null,
  hubFormula?: ContributionFormula | null
): AppState {
  const fromEvent = event?.contributionFormula
    ? normalizeContributionFormula(event.contributionFormula)
    : null;
  const fromHub = hubFormula ? normalizeContributionFormula(hubFormula) : null;
  const nextFormula = fromEvent ?? fromHub;
  if (!nextFormula) return state;
  return { ...state, contributionFormula: nextFormula };
}

function memberHasContributionSources(
  memberId: string,
  state: Pick<AppState, "donors" | "contributionLogs">
): boolean {
  const id = String(memberId || "").trim();
  if (!id) return false;
  const hasDonor = (state.donors || []).some(
    (d) =>
      !isDonorExcludedFromDonationTotals(d) &&
      String(d.memberId || "").trim() === id
  );
  if (hasDonor) return true;
  return (state.contributionLogs || []).some(
    (log) => String(log.memberId || "").trim() === id
  );
}

/** 🔥 syncMemberTotalsFromDonors identity memo
 *  ✅ self identity only (동일 객체 재호출시 즉시 반환)
 *  merge·repair·coalesce 체인 내 새 shell 생성 후 같은 state 객체에 대해 반복 호출 3~4회를 캐치
 *  ⚠️ 5중 WeakMap composite cache는 의도치 않은 stale hit를 유발하므로 제거 (정확성 > 성능)
 */
const syncMemoSelf = new WeakMap<object, AppState>();

/** 후원자 리스트(donors) 기준으로 멤버 계좌·투네 합계 재계산 — 순위·엑셀표 금액 불일치 방지 */
export function syncMemberTotalsFromDonors(state: AppState): AppState {
  const selfCached = syncMemoSelf.get(state);
  if (selfCached) return selfCached;

  const totals = new Map<string, { account: number; toon: number }>();
  for (const member of state.members || []) {
    totals.set(member.id, { account: 0, toon: 0 });
  }
  for (const donor of dedupeDonorRows(state.donors || [])) {
    if (isDonorExcludedFromDonationTotals(donor)) continue;
    const memberId = String(donor.memberId || "").trim();
    if (!memberId || !totals.has(memberId)) continue;
    const bucket = totals.get(memberId)!;
    const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
    if ((donor.target || "account") === "toon") bucket.toon += amount;
    else bucket.account += amount;
  }
  const positions = state.memberPositions || null;
  const members = (state.members || []).map((member) => {
    const bucket = totals.get(member.id) || { account: 0, toon: 0 };
    const isOperating = isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      positions
    );
    const contribution =
      isOperating || !memberHasContributionSources(member.id, state)
        ? Math.max(0, Number(member.contribution) || 0)
        : resolveMemberContributionTotal(member.id, state);
    return {
      ...member,
      account: bucket.account,
      toon: bucket.toon,
      contribution,
    };
  });
  const result = { ...state, members };
  syncMemoSelf.set(state, result);
  return result;
}

/** @deprecated 이중 경로는 near-content dedupe(3s)·릴레이 차단으로 처리 */
export const DONATION_NEAR_DUP_WINDOW_MS = 3_000;

export function donationContentMatchKey(donor: {
  name?: string;
  donorName?: string;
  amount?: number;
  target?: string;
  message?: string;
}): string {
  const name = String(donor.donorName ?? donor.name ?? "")
    .trim()
    .toLowerCase();
  const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
  const target = resolveEffectiveDonorTarget(donor);
  const msg = String(donor.message || "")
    .trim()
    .toLowerCase();
  return `${name}|${amount}|${target}|${msg}`;
}

function donorTargetField(target?: string): "account" | "toon" {
  return target === "toon" ? "toon" : "account";
}

/**
 * 채널 주인 리맵이 한쪽만 적용되면 같은 투네 원문이
 * `익명(계좌)` + `철수(투네)` 로 갈라져 들어온다 — 금액·메시지·시각으로 묶는다.
 */
export function isOwnerRemapSplitDuplicate(
  existing: { name?: string; amount?: number; target?: string; message?: string; at?: number | string; memberId?: string },
  incoming: { donorName?: string; amount?: number; target?: string; message?: string; at?: string | number; memberId?: string }
): boolean {
  const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
  const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
  if (amountA <= 0 || amountA !== amountB) return false;
  const atA = donorAtEpochMs(existing);
  const atB =
    typeof incoming.at === "number" && Number.isFinite(incoming.at)
      ? incoming.at
      : toEpochMs(String(incoming.at || ""));
  if (Math.abs(atA - atB) > DONATION_NEAR_DUP_WINDOW_MS) return false;
  const targetA = donorTargetField(existing.target);
  const targetB = donorTargetField(incoming.target);
  if (targetA === targetB) return false;
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
  /** 리맵 후 메시지 비움 + 원문도 비어 있을 때 — 익명 계좌 vs 원닉 투네 */
  if (!msgA && !msgB) {
    const anon = (n: string) => {
      const t = String(n || "").trim().toLowerCase();
      return t === "익명" || t === "anonymous" || t === "anon" || t === "unknown";
    };
    if (anon(nameA) || anon(nameB)) return true;
  }
  return false;
}

function donationContentProbe(donor: {
  name?: string;
  donorName?: string;
  amount?: number;
  target?: string;
  message?: string;
}) {
  return {
    name: donor.name,
    donorName: donor.donorName ?? donor.name,
    amount: donor.amount,
    target: donor.target,
    message: donor.message,
  };
}

/** 동일 후원자·금액·대상·메시지가 DONATION_NEAR_DUP_WINDOW_MS 이내 */
export function isNearContentDuplicate(
  existing: { name?: string; amount?: number; target?: string; message?: string; at?: number | string },
  incoming: {
    donorName?: string;
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: string | number;
    id?: string;
    externalId?: string;
  },
  windowMs = DONATION_NEAR_DUP_WINDOW_MS
): boolean {
  if (
    donationContentMatchKey(donationContentProbe(existing)) !==
    donationContentMatchKey(donationContentProbe(incoming))
  ) {
    return false;
  }
  const atA = donorAtEpochMs(existing);
  const atB = donorAtEpochMs(incoming);
  if (!atA || !atB) return false;
  return Math.abs(atA - atB) <= windowMs;
}

function reliableExtFromIncoming(incoming: {
  id?: string;
  externalId?: string;
}): string | null {
  const fromId = extractReliableToonationExtFromDonorId(String(incoming.id || ""));
  if (fromId) return fromId;
  const ext = String(incoming.externalId || "").trim();
  if (ext) {
    const fromExt = extractReliableToonationExtFromDonorId(`toonation:${ext}`);
    if (fromExt) return fromExt;
    if (isReliableToonationExternalId(ext)) return ext.toLowerCase();
  }
  return null;
}

/** 동일 투네 실 id + 금액 — ingest 경로·시각 skew 로 3초 밖에도 이중 반영될 수 있음 */
function isSameToonationEventNearDuplicate(
  existing: {
    id?: string;
    amount?: number;
    at?: number | string;
    externalId?: string;
    rawHash?: string | number;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
    memberId?: string;
    donationExcluded?: boolean;
  },
  incoming: {
    id?: string;
    externalId?: string;
    amount?: number;
    at?: string | number;
    rawHash?: string | number;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
    memberId?: string;
    donationExcluded?: boolean;
  }
): boolean {
  /**
   * ★ 3연속 동일금액 weak fallback id 오판 봉쇄 + WS+폴링 중복수신 dedup gap 동시 수리:
   *  - 양쪽 reliable UUID externalId 존재 & 일치 & 금액 같음 → 같은 이벤트로 취급 (weak id 여도 무관)
   *  - 양쪽 donor.id 또는 externalId 중 하나라도 weak id (`fp-{ts}-{amount}`, `{ts}-{amount}` 등) 이면,
   *    "실제 같은 이벤트" 인지 여부를 reliable ext(UUID) 없이 판단하기 불가능하므로 →
   *    양쪽 id 문자열이 **완전 100% 일치** 할 때만 dedup 허용. (3연속 후원 = 3개의 id 문자열 각기 다름 → dedup 안됨 → 3건 유지)
   */
  const existingRaw = String(existing.id || "").trim();
  const incomingRaw = String(incoming.id || "").trim();
  {
    const existingReliableExt =
      extractReliableToonationExtFromDonorId(existingRaw) ||
      (() => {
        const e = String(existing.externalId || existing.rawHash || "").trim();
        return e && isReliableToonationExternalId(e) ? e.toLowerCase() : null;
      })();
    const incomingReliableExt =
      extractReliableToonationExtFromDonorId(incomingRaw) || reliableExtFromIncoming(incoming);
    if (existingReliableExt && incomingReliableExt && existingReliableExt === incomingReliableExt) {
      const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
      const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
      if (amountA > 0 && amountA === amountB) {
        const atA = donorAtEpochMs(existing);
        const atB = donorAtEpochMs(incoming);
        if (!atA || !atB) return true;
        return Math.abs(atA - atB) <= SAME_TOONATION_EVENT_NEAR_DUP_MS;
      }
    }
  }
  if (existingRaw && incomingRaw && (isWeakToonationDonorId(existingRaw) || isWeakToonationDonorId(incomingRaw))) {
    return existingRaw === incomingRaw;
  }
  const extA = extractReliableToonationExtFromDonorId(String(existing.id || ""));
  const extB = reliableExtFromIncoming(incoming);
  if (!extA || !extB || extA !== extB) return false;
  const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
  const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
  if (amountA <= 0 || amountA !== amountB) return false;
  const atA = donorAtEpochMs(existing);
  const atB = donorAtEpochMs(incoming);
  if (!atA || !atB) return false;
  return Math.abs(atA - atB) <= SAME_TOONATION_EVENT_NEAR_DUP_MS;
}

function identicalMessageNearDupWindowMs(
  existing: { message?: string },
  incoming: { message?: string }
): number | null {
  const msgA = String(existing.message || "").trim().toLowerCase();
  const msgB = String(incoming.message ?? "").trim().toLowerCase();
  if (!msgA || !msgB || msgA !== msgB) return null;
  return DONATION_IDENTICAL_MESSAGE_NEAR_DUP_MS;
}

function resolveNearDupWindowMs(
  existing: { message?: string; id?: string; amount?: number; at?: number | string },
  incoming: {
    message?: string;
    id?: string;
    externalId?: string;
    amount?: number;
    at?: string | number;
  }
): number {
  const msgWindow = identicalMessageNearDupWindowMs(existing, incoming);
  if (msgWindow != null) return msgWindow;
  const extA = extractReliableToonationExtFromDonorId(String(existing.id || ""));
  const extB = reliableExtFromIncoming(incoming);
  if (extA && extB && extA === extB) return SAME_TOONATION_EVENT_NEAR_DUP_MS;
  return DONATION_NEAR_DUP_WINDOW_MS;
}

/**
 * ★ 근본 뿌리 FIX: donor가 어느 경로(tuna/bank/기타)에서 왔는지 추론 함수.
 *   기존 donorIdSourceKind(id) 처럼 id 접두사만 보고 판단하면 → B·DIN 허브 풀링 경로에서
 *   실제로는 provider=toonation / externalId=UUID 인 donor가 id=bank:din:xxx 접두사 때문에
 *   무조건 "bank" 로 오분류 → shouldTreatAsCrossSourceDuplicate에서 투네 실시간 ingest와
 *   bank↔toonation CROSS PAIR로 오판 → 4건 2건씩 merge drop + 계좌 둔갑 + 가짜이름 "후원" 덮어씌기 버그 전부 유발.
 *
 *   ★ target=account 는 "멤버의 계좌 컬럼에 적립" 의미일 뿐, 후원 소스가 bank 라는 뜻이 절대 아님!
 *     L618 fixture: id=toonation:fp-* (투네) · target=account 인 경우 target 1순위 때문에 bank 오분류 → cross=true → 16s 갭 후원 drop 되는 버그
 *     → 해결: provider·UUID·id-prefix 를 target 보다 절대 먼저 평가, target은 최후 보조 수단으로 격하
 *
 *   판단 우선순위 (확실한 증거부터 위에 둠 · 상단이 절대 우선):
 *   1. provider 명시 → toonation (toonation/toona/tuna/tunat) OR bank (bank/sms/account/din_bank)
 *   2. externalId/rawHash: UUID 형식이면 100% toonation (DIN 허브 9.4 body.id UUID)
 *   3. id 접두사 toonation:/toona:/tuna: → toonation / bank:/account: → bank
 *   4. target: (명시적 증거가 전혀 없을 때만 최후 보조) toon/투네 등 → toonation / account/계좌 등 → bank
 *   5. 그 외: other
 */
function donorInferSourceKind(
  d:
    | {
        id?: unknown;
        target?: unknown;
        provider?: unknown;
        externalId?: unknown;
        rawHash?: unknown;
      }
    | string
    | null
    | undefined
): "bank" | "toonation" | "other" {
  if (!d) return "other";
  let id = "";
  let target = "";
  let provider = "";
  let ext = "";
  if (typeof d === "string") {
    id = d.trim().toLowerCase();
  } else {
    id = String(d.id ?? "").trim().toLowerCase();
    target = String(d.target ?? "").trim().toLowerCase();
    provider = String(d.provider ?? "").trim().toLowerCase();
    ext = String(d.externalId ?? d.rawHash ?? "").trim();
  }
  /** 1순위: provider 필드가 명시적으로 붙어있는 경우 (투네 허브 풀링 경로에서 100% 채워줌) */
  if (["toonation", "toona", "tuna", "tunat"].includes(provider)) return "toonation";
  if (["bank", "sms", "account", "din_bank"].includes(provider)) return "bank";
  /** 2순위: externalId/rawHash 가 정식 UUID = 투네 실제 후원 외에는 발생하지 않는 값 */
  if (ext && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(ext)) return "toonation";
  /** 3순위: id 접두사 (raw id 가 이미 출처를 나타내는 prefix 를 달고 나오는 경우가 대부분) */
  if (id.startsWith("toonation:") || id.startsWith("toona:") || id.startsWith("tuna:")) return "toonation";
  if (id.startsWith("bank:") || id.startsWith("account:")) return "bank";
  /** 4순위: target — 위 1~3순위에서 명시적 증거가 하나도 없을 때만 보조적으로 사용 (오판 방지) */
  if (["toon", "toonation", "tunat", "tuna", "투네", "튜나"].includes(target)) return "toonation";
  if (["account", "bank", "계좌", "은행"].includes(target)) return "bank";
  return "other";
}

/** @deprecated — donorInferSourceKind 로 대체. id 접두사만 보는 오판 가능성 있음 */
function donorIdSourceKind(id: string): "bank" | "toonation" | "other" {
  return donorInferSourceKind(id);
}

/** DIN bank ingest ↔ 투네 WS (또는 bank 재전송) */
export function isCrossDonationSourcePair(
  a?: { id?: unknown; target?: unknown; provider?: unknown; externalId?: unknown; rawHash?: unknown } | string | null,
  b?: { id?: unknown; target?: unknown; provider?: unknown; externalId?: unknown; rawHash?: unknown } | string | null
): boolean {
  const kindA = donorInferSourceKind(a as never);
  const kindB = donorInferSourceKind(b as never);
  if (kindA === "bank" && kindB === "toonation") return true;
  if (kindA === "toonation" && kindB === "bank") return true;
  return false;
}

function normalizeDonorNameKey(raw?: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * 서로 다른 수집 경로·재전송으로 같은 후원이 두 번 들어오는 경우.
 * 이름+금액(+근접 시각). 메시지는 경로마다 다를 수 있어 필수로 두지 않음.
 */
export function shouldTreatAsCrossSourceDuplicate(
  existing: {
    id?: string;
    name?: string;
    amount?: number;
    at?: number | string;
    externalId?: string;
    rawHash?: string | number;
    donorName?: string;
    target?: string;
    provider?: string;
  },
  incoming: {
    id?: string;
    donorName?: string;
    name?: string;
    amount?: number;
    at?: string | number;
    externalId?: string;
    rawHash?: string | number;
    target?: string;
    provider?: string;
  }
): boolean {
  /** ★ 근본 FIX: donor 전체 객체를 donorInferSourceKind 에 넣어 실 경로 추론
   *  (id 접두사만 보고 bank로 오판하는 경우 원천 봉쇄 — provider=toonation / UUID externalId 면 1~3순위에서 무조건 toonation 으로 분류)
   */
  const cross = isCrossDonationSourcePair(existing, incoming);
  const bothBank =
    donorInferSourceKind(existing) === "bank" && donorInferSourceKind(incoming) === "bank";
  if (!cross && !bothBank) return false;

  /** reliable externalId UUID가 양쪽 모두 존재하면 서로 달라 = 다른 후원 → merge 불가 */
  const extA = String(existing.externalId || existing.rawHash || "").trim();
  const extB = String(incoming.externalId || incoming.rawHash || "").trim();
  if (extA && extB && isReliableToonationExternalId(extA) && isReliableToonationExternalId(extB)) {
    if (extA.toLowerCase() !== extB.toLowerCase()) return false;
  }
  const idExtA = extractReliableToonationExtFromDonorId(String(existing.id || ""));
  const idExtB = extractReliableToonationExtFromDonorId(String(incoming.id || ""));
  if (idExtA && idExtB && idExtA !== idExtB) return false;

  const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
  const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
  if (amountA <= 0 || amountA !== amountB) return false;

  const nameA = normalizeDonorNameKey(existing.name ?? existing.donorName);
  const nameB = normalizeDonorNameKey(incoming.donorName ?? incoming.name);
  if (!nameA || !nameB || nameA !== nameB) return false;

  const atA = donorAtEpochMs(existing);
  const atB = donorAtEpochMs(incoming);
  if (!atA || !atB) return false;
  const windowMs = cross ? CROSS_SOURCE_NEAR_DUP_MS : BANK_RESEND_NEAR_DUP_MS;
  return Math.abs(atA - atB) <= windowMs;
}

/**
 * 서버 자동 반영 + 관리자 큐·union 등 이중 경로 — 동일 내용·근접 시각이면 1건.
 * 투네 실 id 가 서로 다른 연속 후원(동일 메시지·1초 간격 등)은 유지.
 */
export function shouldTreatAsDuplicateDonationContent(
  existing: {
    id?: string;
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: number | string;
    externalId?: string;
    rawHash?: string | number;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
    memberId?: string;
    donationExcluded?: boolean;
  },
  incoming: {
    id?: string;
    externalId?: string;
    donorName?: string;
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: string | number;
    rawHash?: string | number;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
    memberId?: string;
    donationExcluded?: boolean;
  }
): boolean {
  /**
   * ★ 단체짠 나누기 스플릿 파트 donor 끼리 절대 dedup 금지:
   *  동일 donorName·동일메시지·동일 at·동일금액 2000원 5행 일괄 생성 → 기존 identical-message window dedup 이 5행을 전부 중복 오판.
   *  memberId가 서로 다른 파트 donor → 서로 다른 후원 → dedup bypass return false 강제.
   */
  const existingSplit =
    Boolean(existing.groupSplit) ||
    String(existing.id || "").includes(":split:") ||
    Boolean(existing.groupSplitSource);
  const incomingSplit =
    Boolean(incoming.groupSplit) ||
    String(incoming.id || "").includes(":split:") ||
    Boolean(incoming.groupSplitSource);
  if (existingSplit || incomingSplit) {
    const existingMemId = String(existing.memberId || "").trim();
    const incomingMemId = String(incoming.memberId || "").trim();
    if (existingSplit !== incomingSplit) return false;
    if (existingMemId && incomingMemId && existingMemId !== incomingMemId) return false;
    if (
      Boolean(existing.groupSplit) !== Boolean(incoming.groupSplit) ||
      Boolean(existing.groupSplitSource) !== Boolean(incoming.groupSplitSource)
    ) {
      return false;
    }
  }
  /**
   * ★ 3연속 후원 drop 방지 + WS+폴링 2행 중복 해소 · 총 8단계 dedup 파이프라인:
   *   ① 릴레이블 UUID externalId 일치 + 금액 일치 = 무조건 dedup (경로 2중 수신 봉쇄 · weak id 여부 무관)
   *   ② Cross-Source (bank↔투네) / Bank 재전송 = 전문 윈도우 (30s) dedup
   *   ②-1 Owner Remap Split = target 반대 쌍 (투네↔계좌) + 금액·at·메시지 동일 = dedup (David 51k 2행 FIX)
   *   ②-2 Instant Burst = 동일 donor·금액·at ≤ 1000ms 극단 burst = 무조건 dedup (자키집 19k 4:23:00 2행 FIX)
   *   ②-3 Dual-Path Reliable Mismatch = 양쪽 모두 진짜 reliable UUID 존재·서로 다름 + donor+금액+대상+at≤3s+메시지 동일 = dedup (David 200k 투네+DIN경로 2행 FIX)
   *   ③ 동일 투네 이벤트 (reliable ext + weak 내부) = 15s 윈도우 dedup
   *   ④ Weak bypass (3연속 후원 drop 방어): weak id 존재 + identical message 아님 + cross-source 아님 → rawId 100% 일치만 dedup
   *   ⑤ Near-Content (donor+금액+대상+메시지) 윈도우 dedup + 최종 ext UUID 불일치 차단
   */
  const existingRawId = String(existing.id || "").trim();
  const incomingRawId = String(incoming.id || "").trim();
  /** ① reliable UUID externalId = 동일 이벤트 (금액 같으면 무조건 dedup) */
  {
    const existingReliableExt =
      extractReliableToonationExtFromDonorId(existingRawId) ||
      (() => {
        const e = String(existing.externalId || existing.rawHash || "").trim();
        return e && isReliableToonationExternalId(e) ? e.toLowerCase() : null;
      })();
    const incomingReliableExt =
      extractReliableToonationExtFromDonorId(incomingRawId) || reliableExtFromIncoming(incoming);
    if (existingReliableExt && incomingReliableExt && existingReliableExt === incomingReliableExt) {
      const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
      const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
      if (amountA > 0 && amountA === amountB) return true;
    }
  }
  /** ② Cross-Source (bank ↔ 투네) · bank 재전송은 weak bypass 보다 먼저 처리 */
  if (shouldTreatAsCrossSourceDuplicate(existing, incoming)) return true;
  /** ②-1 Owner Remap Split (target 반대 쌍 = 투네/계좌 로 갈라진 동일 후원 2행 FIX
   *  - WS 경로 = target:toon · DIN 허브 폴링 경로 = target:account 양쪽 동일 donor·금액·at 이 2행 쌓이는 버그
   *  - donorInferSourceKind 와 무관하게 target 필드 반대 여부로 잡아내는 isOwnerRemapSplitDuplicate 여기서 직접 호출 */
  if (isOwnerRemapSplitDuplicate(existing, incoming)) return true;
  /** ②-2 Instant Burst (극단적 동일 시각 중복: 4:23:00 동일 second 내에 동일 donor 동일 금액 2행 burst)
   *  DONATION_NEAR_DUP_WINDOW_MS(3s) 보다 더 엄격한 1000ms window. donorName match + amount match + at ≤ 1000ms.
   *  단, reliable ext 가 양쪽에 있고 서로 다르면 3연속 개별 후원 일 수 있으므로 ext 불일치 시 bypass. */
  {
    const burstAmountA = Math.max(0, Math.round(Number(existing.amount) || 0));
    const burstAmountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
    if (burstAmountA > 0 && burstAmountA === burstAmountB) {
      const burstAt1 = donorAtEpochMs(existing);
      const burstAt2 = donorAtEpochMs(incoming);
      if (burstAt1 && burstAt2 && Math.abs(burstAt1 - burstAt2) < 1_000) {
        const burstNameA = String(existing.name || "").trim().toLowerCase();
        const burstNameB = String(incoming.donorName || incoming.name || "").trim().toLowerCase();
        const extAA = extractReliableToonationExtFromDonorId(existingRawId);
        const extBB = extractReliableToonationExtFromDonorId(incomingRawId);
        // 양쪽 ext reliable + 서로 다름 = 3연속 개별 후원 케이스 → dedup PASS (3건 유지)
        const bothReliableAndDifferent = extAA && extBB && extAA !== extBB;
        if (!bothReliableAndDifferent && burstNameA && burstNameB && burstNameA === burstNameB) {
          return true;
        }
      }
    }
  }
  /** ③ 동일 투네 이벤트 near-dup (내부 reliable ext · weak bypass 포함) */
  if (isSameToonationEventNearDuplicate(existing, incoming)) return true;
  /**
   * ④ Weak bypass (3연속 weak-id 후원 drop 방어):
   *   - 동일 메시지 15s 윈도우 내 = dual-path / WS burst → ⑤ near-content dedup 에게 위임
   *   - cross-source 쌍 또는 bank 재전송 = ② 에서 이미 처리 완료 → 위임
   *   - at gap ≤ DONATION_NEAR_DUP_WINDOW_MS (3s) = dual-path burst → 위임
   *   - 위 어느 것도 아님 = 3연속 개별 후원 케이스 → rawId 문자열 100% 일치만 dedup 허용 (건별 유지)
   */
  if (existingRawId && incomingRawId && (isWeakToonationDonorId(existingRawId) || isWeakToonationDonorId(incomingRawId))) {
    const msgWindow = identicalMessageNearDupWindowMs(existing, incoming);
    const crossOrBothBank =
      isCrossDonationSourcePair(existing, incoming) ||
      (donorInferSourceKind(existing) === "bank" && donorInferSourceKind(incoming) === "bank");
    const atA = donorAtEpochMs(existing);
    const atB = donorAtEpochMs(incoming);
    const atGap = atA && atB ? Math.abs(atA - atB) : Infinity;
    const withinAnyNearWindow = msgWindow != null || crossOrBothBank || atGap <= DONATION_NEAR_DUP_WINDOW_MS;
    if (!withinAnyNearWindow) {
      return existingRawId === incomingRawId;
    }
  }
  /** ⑤ Near-Content (donor+금액+대상+메시지 + 윈도우) dedup */
  const windowMs = resolveNearDupWindowMs(existing, incoming);
  if (!isNearContentDuplicate(existing, incoming, windowMs)) return false;
  const extA = extractReliableToonationExtFromDonorId(String(existing.id || ""));
  const extB = reliableExtFromIncoming(incoming);
  /** ★ 서로 다른 투네 실 id = 별도 후원 (동일 문구·동일 금액·윈도우 내 3연속 후원 허용)
   *  ★ [DUAL-PATH EXCEPTION] extA !== extB 라도 prefix 불일치 (경로 출처가 2개 독립) + donor/amount/target/at≤3s/msg 동일 = 100% 동일 후원 2경로 유입 → dedup true */
  if (extA && extB && extA !== extB) {
    const extractPrefix = (raw: string): string => {
      const m = raw.match(/^(.*?)(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})/i);
      return m ? m[1].toLowerCase() : raw.toLowerCase();
    };
    const pA = extractPrefix(existingRawId);
    const pB = extractPrefix(incomingRawId);
    if (pA !== pB) {
      const amtA = Math.max(0, Math.round(Number(existing.amount) || 0));
      const amtB = Math.max(0, Math.round(Number(incoming.amount) || 0));
      if (amtA > 0 && amtA === amtB) {
        const at1 = donorAtEpochMs(existing);
        const at2 = donorAtEpochMs(incoming);
        if (at1 && at2 && Math.abs(at1 - at2) <= 3_000) {
          const tA = String(existing.target || "").trim().toLowerCase();
          const tB = String(incoming.target || "").trim().toLowerCase();
          if (tA && tB && tA === tB) {
            const nA = String(existing.name || "").trim().toLowerCase();
            const nB = String(incoming.donorName || incoming.name || "").trim().toLowerCase();
            if (nA && nB && nA === nB) {
              const m1 = String(existing.message || "").trim();
              const m2 = String(incoming.message || "").trim();
              if (m1 === m2) return true;
            }
          }
        }
      }
    }
    return false;
  }
  /** ★ 양쪽 다 reliable ext 없는 weak id 끼리일 때:
   *   - 둘 다 fp- fallback id = WS dual-path 복제본 케이스 (1·3·5번 테스트) → 무조건 dedup true
   *   - 하나라도 non-fp weak id (seq-, don-real-, 사용자 정의 id 등) 이면:
   *     - at gap < 1000ms = 동일초 burst 복제 → dedup true
   *     - at gap ≥ 1000ms = 3·5연속 개별 후원 패턴 (2·4번 테스트) → rawId 일치만 dedup (건별 유지)
   */
  if (!extA && !extB) {
    const isFpA = /\bfp-/.test(existingRawId);
    const isFpB = /\bfp-/.test(incomingRawId);
    if (isFpA && isFpB) return true;
    const at5A = donorAtEpochMs(existing);
    const at5B = donorAtEpochMs(incoming);
    const gap5 = at5A && at5B ? Math.abs(at5A - at5B) : Infinity;
    if (gap5 < 1_000) {
      const name5A = normalizeDonorNameKey(existing.name);
      const name5B = normalizeDonorNameKey(incoming.donorName ?? incoming.name);
      if (name5A && name5B && name5A !== name5B) return existingRawId === incomingRawId;
      const mem5A = String(existing.memberId || "").trim();
      const mem5B = String(incoming.memberId || "").trim();
      if (mem5A && mem5B && mem5A !== mem5B) return existingRawId === incomingRawId;
      const tgt5A = String(existing.target || "").trim().toLowerCase();
      const tgt5B = String(incoming.target || "").trim().toLowerCase();
      if (tgt5A && tgt5B && tgt5A !== tgt5B) return existingRawId === incomingRawId;
      return true;
    }
    return existingRawId === incomingRawId;
  }
  return true;
}

/** @deprecated — shouldTreatAsDuplicateDonationContent 사용 */
export function isSameInstantContentDuplicate(
  existing: { name?: string; amount?: number; target?: string; message?: string; at?: number | string },
  incoming: {
    donorName?: string;
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: string | number;
    id?: string;
    externalId?: string;
  }
): boolean {
  return shouldTreatAsDuplicateDonationContent(existing, incoming);
}

/** 동일 투네·계좌 후원 id가 이미 donors에 있으면 중복(건별 unique id 기준) */
export function isDuplicateDonationEvent(state: AppState, rawEvent: DonationEvent): boolean {
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
    memberId: String((rawEvent as { memberId?: string })?.memberId || "").trim() || undefined,
  };
  const probeKey = donorRowDedupeKey(probeDonor);

  return donors.some((d) => {
    const donorId = String(d.id || "").trim();
    if (!donorId) return false;
    if (
      shouldTreatAsDuplicateDonationContent(d, {
        ...probeDonor,
        id: eventId || externalDonorId,
        externalId,
      })
    ) {
      return true;
    }
    if (donorRowDedupeKey(d) === probeKey) return true;
    if (donorId === eventId || donorId === baseId) return true;
    if (baseId && normalizeDonationEventId(donorId) === baseId) return true;
    if (externalDonorId && (donorId === externalDonorId || normalizeDonationEventId(donorId) === externalDonorId)) {
      return true;
    }
    /** toona pull(`bank:din:{id}`) ↔ 실시간 ingest(`bank:sms:…` / `toonation:…`) — 동일 externalId */
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
    /** 주인 리맵 유무가 갈라져 익명(계좌)·원닉(투네)로 동시에 쌓이는 경우 */
    if (isOwnerRemapSplitDuplicate(d, rawEvent)) return true;
    return false;
  });
}

/** 후원 1건을 AppState(멤버·donors·식사대전)에 반영 — 클라이언트·서버 공통 */
export function applyDonationToAppState(
  currentState: AppState,
  rawEvent: DonationEvent,
  aliases: DonorAlias[] = []
): ApplyDonationResult {
  if (isDuplicateDonationEvent(currentState, rawEvent)) {
    return { ok: false, reason: "duplicate", event: rawEvent };
  }

  const manualMemberId = String(rawEvent.manualAssignMemberId || "").trim();
  let processedEvent: DonationEvent;
  if (manualMemberId) {
    const exists = (currentState.members || []).some((m) => m.id === manualMemberId);
    if (!exists) {
      return {
        ok: false,
        reason: "unmatched",
        event: { ...rawEvent, status: "unmatched" },
      };
    }
    processedEvent = { ...rawEvent, memberId: manualMemberId, status: "processed" };
  } else {
    processedEvent = mapToMember(rawEvent, currentState.members || [], aliases, {
      /** 유사 일치 실패 시: 소액(≤1천)은 운영비→1위, 그 외는 1위→운영비→대표→국고 */
      autoAssignToonPlayer: true,
      memberPositions: currentState.memberPositions,
    });
  }
  if (!processedEvent.memberId) {
    return { ok: false, reason: "unmatched", event: { ...processedEvent, status: "unmatched" } };
  }

  const newDonor = {
    id: processedEvent.id,
    name: normalizeAnonymousDonorDisplayName(processedEvent.donorName),
    amount: Math.max(0, Math.round(Number(processedEvent.amount) || 0)),
    memberId: processedEvent.memberId,
    at: processedEvent.at,
    target: processedEvent.target || "toon",
    ...(String(processedEvent.message || "").trim()
      ? { message: String(processedEvent.message).trim() }
      : {}),
    ...(processedEvent.hsPushDir === "left" ||
    processedEvent.hsPushDir === "right" ||
    processedEvent.hsPushDir === "split"
      ? { hsPushDir: processedEvent.hsPushDir }
      : {}),
  };
  const atMs = toEpochMs(processedEvent.at);
  const formulaState = mergeContributionFormulaIntoState(currentState, processedEvent);
  const { formula, contributionPoints } = resolveApplyContributionContext(
    formulaState,
    processedEvent,
    newDonor.amount,
    newDonor.target
  );

  const syncMode = currentState.donationSyncMode || "mealBattle";
  const mealRaw = mealBattleUsesRawDonationScore(currentState.mealBattle);
  const mealParticipants =
    syncMode === "mealBattle"
      ? applyMealBattleDonationToParticipants(
          currentState.mealBattle?.participants || [],
          newDonor.memberId,
          newDonor.amount,
          1,
          atMs,
          mealRaw
        )
      : (currentState.mealBattle?.participants || []);

  const now = Date.now();
  const existingDonors = currentState.donors || [];
  if (existingDonors.some((d) => String(d.id || "").trim() === String(newDonor.id || "").trim())) {
    return { ok: false, reason: "duplicate", event: rawEvent };
  }
  const updatedState = syncMemberTotalsFromDonors({
    ...currentState,
    contributionFormula: formula,
    donors: dedupeDonorRows([
      ...existingDonors,
      {
        id: newDonor.id,
        name: newDonor.name,
        amount: newDonor.amount,
        memberId: newDonor.memberId,
        at: atMs,
        target: newDonor.target,
        contributionPoints,
        ...(newDonor.message ? { message: newDonor.message } : {}),
        ...(newDonor.hsPushDir ? { hsPushDir: newDonor.hsPushDir } : {}),
        ...(processedEvent.memberAutoAssigned ? { memberAutoAssigned: true } : {}),
        ...(normalizeHighSocietySettings(currentState.highSocietySettings).enabled ||
        !isDonationAmountEligibleForHighSocietyTerritory(newDonor.amount)
          ? { hsTerritoryExcluded: true as const }
          : {}),
      },
    ]),
    mealBattle: {
      ...currentState.mealBattle,
      participants: mealParticipants,
    },
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    state: syncHighSocietyMemberWidthSnapshotInState(updatedState),
    event: { ...processedEvent, memberId: processedEvent.memberId, status: "processed" },
  };
}

/** 후원 기록 삭제 — 리스트에서 선택한 1건만 수동 제거 */
export function revertDonationFromAppState(currentState: AppState, donorId: string): AppState | null {
  const donor = (currentState.donors || []).find((d) => d.id === donorId);
  if (!donor) return null;
  if (isDonorExcludedFromDonationTotals(donor)) return null;

  const field = resolveEffectiveDonorTarget(donor);
  const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
  const atMs = donorAtEpochMs(donor);
  const formula = normalizeContributionFormula(currentState.contributionFormula);
  const storedPoints = Number(donor.contributionPoints);
  const contributionPoints =
    Number.isFinite(storedPoints) && storedPoints >= 0
      ? Math.round(storedPoints)
      : computeContributionPoints(amount, field, formula);

  const syncMode = currentState.donationSyncMode || "mealBattle";
  const mealRaw = mealBattleUsesRawDonationScore(currentState.mealBattle);
  const mealParticipants =
    syncMode === "mealBattle"
      ? applyMealBattleDonationToParticipants(
          currentState.mealBattle?.participants || [],
          donor.memberId,
          amount,
          -1,
          atMs,
          mealRaw
        )
      : currentState.mealBattle?.participants || [];

  /** 🔥 Phase3 contribution SoT 단일화: member.contribution 직접 delta 차감 대신 contributionLogs에 마이너스 delta 기록
   *  resolveMemberContributionTotal (L481-L511) = donors 합계 + logs 합계 이므로 자동으로 차감됨.
   *  2중 SoT(직접 member값 + 합계) 완전 제거 → revert 테스트 L1263 PASS 확보.
   */
  const now = Date.now();
  const nextContributionLogs: ContributionLog[] = [
    ...(currentState.contributionLogs || []),
    ...(contributionPoints > 0
      ? [
          {
            id: `revert:${donorId}:${now}`,
            memberId: String(donor.memberId || "").trim(),
            amount: contributionPoints,
            delta: -1 as const,
            note: `revert donor ${donor.name || donorId}`,
            at: now,
          },
        ]
      : []),
  ];

  let removed = false;
  const nextDonors = (currentState.donors || []).filter((d) => {
    if (!removed && d.id === donorId) {
      removed = true;
      return false;
    }
    return true;
  });
  return syncHighSocietyMemberWidthSnapshotInState(
    syncMemberTotalsFromDonors({
      ...currentState,
      donors: nextDonors,
      contributionLogs: nextContributionLogs,
      mealBattle: {
        ...currentState.mealBattle,
        participants: mealParticipants,
      },
      donorRankingsUpdatedAt: now,
      updatedAt: now,
    })
  );
}

/**
 * 후원자명은 유지하고 배치 멤버만 변경.
 * 멤버 계좌/투네 합계는 donors 기준으로 재동기화하고, 식대전 연동 점수도 이전/신규 멤버에 반영.
 */
export function reassignDonorMemberInAppState(
  currentState: AppState,
  donorId: string,
  nextMemberId: string
): AppState | null {
  const targetMemberId = String(nextMemberId || "").trim();
  if (!targetMemberId) return null;
  if (!(currentState.members || []).some((m) => m.id === targetMemberId)) return null;

  const donor = (currentState.donors || []).find((d) => d.id === donorId);
  if (!donor) return null;
  const prevMemberId = String(donor.memberId || "").trim();
  if (prevMemberId === targetMemberId) return null;

  const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
  const atMs = Number.isFinite(Number(donor.at)) ? Math.max(0, Math.floor(Number(donor.at))) : Date.now();
  const syncMode = currentState.donationSyncMode || "mealBattle";
  const mealRaw = mealBattleUsesRawDonationScore(currentState.mealBattle);
  let mealParticipants = currentState.mealBattle?.participants || [];

  if (syncMode === "mealBattle" && amount > 0 && !isDonorExcludedFromDonationTotals(donor)) {
    if (prevMemberId) {
      mealParticipants = applyMealBattleDonationToParticipants(
        mealParticipants,
        prevMemberId,
        amount,
        -1,
        atMs,
        mealRaw
      );
    }
    mealParticipants = applyMealBattleDonationToParticipants(
      mealParticipants,
      targetMemberId,
      amount,
      1,
      atMs,
      mealRaw
    );
  }

  const formula = normalizeContributionFormula(currentState.contributionFormula);
  const storedPoints = Number(donor.contributionPoints);
  const contributionPoints =
    Number.isFinite(storedPoints) && storedPoints >= 0
      ? Math.round(storedPoints)
      : computeContributionPoints(amount, donor.target || "account", formula);

  /** 🔥 Phase3 contribution SoT 단일화: member.contribution 직접 차감/가산 대신 contributionLogs에 delta 2행 기록
   *  prev 멤버: delta=-1 차감 / target 멤버: delta=1 가산 → resolveMemberContributionTotal 이 자동 합산
   *  2중 SoT 완전 제거 → 기여도 정합성 donors+logs 단일 SoT로 통합
   */
  const now = Date.now();
  const logs: ContributionLog[] = [];
  if (contributionPoints > 0 && !isDonorExcludedFromDonationTotals(donor)) {
    const positions = currentState.memberPositions || null;
    const isOperating = (mid: string) =>
      isOperatingSettlementMember(
        (currentState.members || []).find((m) => m.id === mid) || { id: mid, name: "", operating: false },
        positions
      );
    if (prevMemberId && !isOperating(prevMemberId)) {
      logs.push({
        id: `reassign:${donorId}:prev:${now}`,
        memberId: prevMemberId,
        amount: contributionPoints,
        delta: -1 as const,
        note: `reassign to ${targetMemberId}`,
        at: now,
      });
    }
    if (!isOperating(targetMemberId)) {
      logs.push({
        id: `reassign:${donorId}:next:${now}`,
        memberId: targetMemberId,
        amount: contributionPoints,
        delta: 1 as const,
        note: `reassign from ${prevMemberId || "none"}`,
        at: now,
      });
    }
  }
  const nextContributionLogs = [...(currentState.contributionLogs || []), ...logs];

  const nextDonors = (currentState.donors || []).map((d) =>
    d.id === donorId
      ? { ...d, memberId: targetMemberId, memberAutoAssigned: false }
      : d
  );

  return syncMemberTotalsFromDonors({
    ...currentState,
    contributionLogs: nextContributionLogs,
    donors: nextDonors,
    mealBattle: {
      ...currentState.mealBattle,
      participants: mealParticipants,
    },
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });
}

/** 후원자 리스트 메시지(comment) 수정 — 금액·멤버·합산에는 영향 없음 */
export function updateDonorMessageInAppState(
  currentState: AppState,
  donorId: string,
  message: string
): AppState | null {
  const id = String(donorId || "").trim();
  if (!id) return null;
  const donor = (currentState.donors || []).find((d) => d.id === id);
  if (!donor) return null;
  const trimmed = String(message || "").trim();
  const prev = String(donor.message || "").trim();
  if (trimmed === prev) return null;
  const now = Date.now();
  const nextDonors = (currentState.donors || []).map((d): Donor => {
    if (d.id !== id) return d;
    if (!trimmed) {
      const { message: _drop, ...rest } = d;
      return rest;
    }
    return { ...d, message: trimmed };
  });
  return {
    ...currentState,
    donors: nextDonors,
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  };
}

/** 상류사회 B·C(가운데) 확장 방향만 변경 — 금액·멤버 합산 불변 */
export function updateDonorHsPushDirInAppState(
  currentState: AppState,
  donorId: string,
  hsPushDir: "left" | "right" | "split" | null
): AppState | null {
  const id = String(donorId || "").trim();
  if (!id) return null;
  const donor = (currentState.donors || []).find((d) => d.id === id);
  if (!donor) return null;
  const prev = donor.hsPushDir || null;
  const nextDir =
    hsPushDir === "left" || hsPushDir === "right" || hsPushDir === "split" ? hsPushDir : null;
  if (prev === nextDir) return null;
  const now = Date.now();
  const nextDonors = (currentState.donors || []).map((d): Donor => {
    if (d.id !== id) return d;
    if (!nextDir) {
      const { hsPushDir: _drop, ...rest } = d;
      return rest;
    }
    return { ...d, hsPushDir: nextDir };
  });
  return {
    ...currentState,
    donors: nextDonors,
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  };
}

/**
 * 수동 방향 변경: 원복(시스템) 후 새 방향 적용.
 * - 상류사회 모드 OFF → 변경 불가
 * - 시스템 기본과 같거나 "system" → hsPushDir 제거(시스템 추종)
 */
export function applyManualHsPushDirChange(
  currentState: AppState,
  donorId: string,
  nextDir: "left" | "right" | "split" | "system"
): AppState | null {
  const settings = normalizeHighSocietySettings(currentState.highSocietySettings);
  if (!settings.enabled) return null;

  const id = String(donorId || "").trim();
  if (!id) return null;
  const donor = (currentState.donors || []).find((d) => d.id === id);
  if (!donor) return null;

  const systemDir = resolveSystemMiddlePushDir(settings);
  const wantOverride =
    nextDir !== "system" &&
    (nextDir === "left" || nextDir === "right" || nextDir === "split") &&
    nextDir !== systemDir
      ? nextDir
      : null;

  const prev = donor.hsPushDir || null;
  if (prev === wantOverride) return null;

  const now = Date.now();
  // 원복 후(필요 시) 변경 — 항상 hsPushDir를 한번 비운 뒤 덮어씀
  const nextDonors = (currentState.donors || []).map((d): Donor => {
    if (d.id !== id) return d;
    const { hsPushDir: _drop, ...rest } = d;
    if (!wantOverride) return rest;
    return { ...rest, hsPushDir: wantOverride };
  });

  return syncHighSocietyMemberWidthSnapshotInState({
    ...currentState,
    donors: nextDonors,
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });
}

/** 후원 행별 상류사회 영토 반영 ON/OFF (순위·멤버 합산과 별개) */
export function applyManualHsTerritoryExcludedChange(
  currentState: AppState,
  donorId: string,
  excluded: boolean
): AppState | null {
  const settings = normalizeHighSocietySettings(currentState.highSocietySettings);
  if (!settings.enabled) return null;

  const id = String(donorId || "").trim();
  if (!id) return null;
  const donor = (currentState.donors || []).find((d) => d.id === id);
  if (!donor) return null;

  const wantExcluded = Boolean(excluded);
  if (
    !wantExcluded &&
    !isDonationAmountEligibleForHighSocietyTerritory(Math.max(0, Number(donor.amount) || 0))
  ) {
    return null;
  }
  const prevExcluded = !isDonorHsTerritoryIncluded(donor);
  if (prevExcluded === wantExcluded) return null;

  const now = Date.now();
  const nextDonors = (currentState.donors || []).map((d): Donor => {
    if (d.id !== id) return d;
    if (wantExcluded) return { ...d, hsTerritoryExcluded: true };
    return { ...d, hsTerritoryExcluded: false };
  });

  return syncHighSocietyMemberWidthSnapshotInState({
    ...currentState,
    donors: nextDonors,
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });
}

/** 상류사회 OFF 시 모든 후원 행 수동 방향 원복 */
export function clearAllDonorHsPushDirs(currentState: AppState): AppState {
  let changed = false;
  const nextDonors = (currentState.donors || []).map((d): Donor => {
    if (!d.hsPushDir) return d;
    changed = true;
    const { hsPushDir: _drop, ...rest } = d;
    return rest;
  });
  if (!changed) return currentState;
  return {
    ...currentState,
    donors: nextDonors,
    updatedAt: Date.now(),
  };
}
