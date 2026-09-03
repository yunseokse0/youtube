import { applyMealBattleDonationToParticipants, mealBattleUsesRawDonationScore } from "@/lib/meal-battle-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { normalizeAnonymousDonorDisplayName } from "@/lib/donation/anonymous-donor-name";
import {
  isDonationAmountEligibleForHighSocietyTerritory,
  isDonorHsTerritoryIncluded,
  normalizeHighSocietySettings,
  resolveSystemMiddlePushDir,
  syncHighSocietyMemberWidthSnapshotInState,
} from "@/lib/high-society";
import type { AppState, Donor, Member, ContributionFormula } from "@/types";
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

/** parse-event fallback id — 동일 후원이 다른 id로 두 번 들어올 수 있음 */
export function isWeakToonationDonorId(id: string): boolean {
  const base = normalizeDonationEventId(String(id || "").trim()).replace(/^toonation:/i, "");
  if (!base) return false;
  if (/^(fp-|test-|toon-)/i.test(base)) return true;
  return /^\d{10,13}-\d+(-\d+-[a-z0-9]+)?$/i.test(base);
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
}): string {
  const rawId = String(donor.id || "").trim();
  const baseId = normalizeDonationEventId(rawId);
  const toonationMatch = /^toonation:(.+)$/i.exec(baseId);
  if (toonationMatch) {
    const ext = toonationMatch[1].toLowerCase();
    /** weak fallback id(`{ts}-{amount}`)도 건별 고유 — 짧은 시간 동일 금액 연속 후원 누락 방지 */
    if (!isWeakToonationDonorId(rawId)) return `toonation:${ext}`;
    return `id:${baseId}`;
  }
  if (baseId) return `id:${baseId}`;
  const name = String(donor.name || "").trim();
  const amount = Math.floor(Number(donor.amount || 0));
  return `fallback:${name}|${donorAtEpochMs(donor)}|${amount}`;
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
    donationExcluded?: boolean;
    hsTerritoryExcluded?: boolean;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
    hsPushDir?: "left" | "right" | "split";
  },
>(preferred: T, fallback?: T | null): T {
  if (!fallback) return preferred;
  const msg = String(preferred.message || "").trim();
  const fallbackMsg = String(fallback.message || "").trim();
  const withMessage = msg || !fallbackMsg ? preferred : { ...preferred, message: fallbackMsg };
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

export function dedupeDonorRows<
  T extends { id?: string; name?: string; amount?: number; at?: number | string; message?: string; target?: string },
>(donors: T[]): T[] {
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
          id: d.id,
          donorName: d.name,
          amount: d.amount,
          target: d.target,
          message: d.message,
          at: d.at,
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
      /** 최신 로스터 교체(멤버 추가/삭제) — 옛 donors 매칭용 로스터로 되돌리지 않음 */
      continue;
    }
    const score = rosterDonorMatchScore(fb.members, donors);
    if (score > bestScore) {
      bestScore = score;
      bestMembers = fb.members;
    }
  }
  if (bestScore <= 0) return state;
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

/** 후원자 리스트(donors) 기준으로 멤버 계좌·투네 합계 재계산 — 순위·엑셀표 금액 불일치 방지 */
export function syncMemberTotalsFromDonors(state: AppState): AppState {
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
  return { ...state, members };
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
  const target = donor.target === "toon" ? "toon" : "account";
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
  existing: { name?: string; amount?: number; target?: string; message?: string; at?: number | string },
  incoming: { donorName?: string; amount?: number; target?: string; message?: string; at?: string | number }
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
  existing: { id?: string; amount?: number; at?: number | string },
  incoming: {
    id?: string;
    externalId?: string;
    amount?: number;
    at?: string | number;
  }
): boolean {
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

function donorIdSourceKind(id: string): "bank" | "toonation" | "other" {
  const s = String(id || "").trim().toLowerCase();
  if (s.startsWith("bank:")) return "bank";
  if (s.startsWith("toonation:") || s.startsWith("toona:")) return "toonation";
  return "other";
}

/** DIN bank ingest ↔ 투네 WS (또는 bank 재전송) */
export function isCrossDonationSourcePair(idA?: string, idB?: string): boolean {
  const a = donorIdSourceKind(String(idA || ""));
  const b = donorIdSourceKind(String(idB || ""));
  if (a === "bank" && b === "toonation") return true;
  if (a === "toonation" && b === "bank") return true;
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
  },
  incoming: {
    id?: string;
    donorName?: string;
    name?: string;
    amount?: number;
    at?: string | number;
  }
): boolean {
  const existingId = String(existing.id || "");
  const incomingId = String(incoming.id || "");
  const cross = isCrossDonationSourcePair(existingId, incomingId);
  const bothBank =
    donorIdSourceKind(existingId) === "bank" && donorIdSourceKind(incomingId) === "bank";
  if (!cross && !bothBank) return false;

  const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
  const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
  if (amountA <= 0 || amountA !== amountB) return false;

  const nameA = normalizeDonorNameKey(existing.name);
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
  }
): boolean {
  if (shouldTreatAsCrossSourceDuplicate(existing, incoming)) return true;
  if (isSameToonationEventNearDuplicate(existing, incoming)) return true;
  const windowMs = resolveNearDupWindowMs(existing, incoming);
  if (!isNearContentDuplicate(existing, incoming, windowMs)) return false;
  const extA = extractReliableToonationExtFromDonorId(String(existing.id || ""));
  const extB = reliableExtFromIncoming(incoming);
  /** 서로 다른 투네 실 id = 별도 후원 (동일 문구 여러 번 후원 허용) */
  if (extA && extB && extA !== extB) return false;
  if (identicalMessageNearDupWindowMs(existing, incoming) != null) return true;
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

  const updatedMembers = currentState.members.map((member) => {
    if (member.id !== newDonor.memberId) return member;
    const field = newDonor.target === "toon" ? "toon" : "account";
    const isOperating = isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      currentState.memberPositions || null
    );
    const prevContribution = Math.max(0, Number(member.contribution) || 0);
    return {
      ...member,
      [field]: (member[field] || 0) + newDonor.amount,
      contribution: isOperating ? prevContribution : prevContribution + contributionPoints,
    };
  });

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
    members: updatedMembers,
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

  const field = (donor.target || "account") === "toon" ? "toon" : "account";
  const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
  const atMs = donorAtEpochMs(donor);
  const formula = normalizeContributionFormula(currentState.contributionFormula);
  const storedPoints = Number(donor.contributionPoints);
  const contributionPoints =
    Number.isFinite(storedPoints) && storedPoints >= 0
      ? Math.round(storedPoints)
      : computeContributionPoints(amount, donor.target || field, formula);

  const members = currentState.members.map((member) => {
    if (member.id !== donor.memberId) return member;
    const isOperating = isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      currentState.memberPositions || null
    );
    const prevContribution = Math.max(0, Number(member.contribution) || 0);
    return {
      ...member,
      contribution: isOperating
        ? prevContribution
        : Math.max(0, prevContribution - contributionPoints),
    };
  });

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

  const now = Date.now();
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
      members,
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

  const positions = currentState.memberPositions || null;
  let members = currentState.members || [];
  if (contributionPoints > 0 && !isDonorExcludedFromDonationTotals(donor)) {
    members = members.map((member) => {
      const isOperating = isOperatingSettlementMember(
        { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
        positions
      );
      if (isOperating) return member;
      const prev = Math.max(0, Number(member.contribution) || 0);
      if (prevMemberId && member.id === prevMemberId) {
        return { ...member, contribution: Math.max(0, prev - contributionPoints) };
      }
      if (member.id === targetMemberId) {
        return { ...member, contribution: prev + contributionPoints };
      }
      return member;
    });
  }

  const now = Date.now();
  const nextDonors = (currentState.donors || []).map((d) =>
    d.id === donorId
      ? { ...d, memberId: targetMemberId, memberAutoAssigned: false }
      : d
  );

  return syncMemberTotalsFromDonors({
    ...currentState,
    members,
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
