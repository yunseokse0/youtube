import { applyMealBattleDonationToParticipants, mealBattleUsesRawDonationScore } from "@/lib/meal-battle-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import type { AppState, Donor } from "@/types";
import { mapToMember } from "./mapper";
import type { DonationEvent, DonorAlias } from "./types";

function toEpochMs(input: string): number {
  const ts = Date.parse(input);
  return Number.isFinite(ts) ? ts : Date.now();
}

export type ApplyDonationResult =
  | { ok: true; state: AppState; event: DonationEvent }
  | { ok: false; reason: "unmatched" | "duplicate"; event: DonationEvent };

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

function donorAtEpochMs(donor: { at?: number | string }): number {
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

/** 동일 id 병합 시 message 등 선택 필드가 비는 쪽을 보완 */
export function mergeDonorRowFields<T extends { message?: string }>(preferred: T, fallback?: T | null): T {
  if (!fallback) return preferred;
  const msg = String(preferred.message || "").trim();
  const fallbackMsg = String(fallback.message || "").trim();
  if (msg || !fallbackMsg) return preferred;
  return { ...preferred, message: fallbackMsg };
}

export function dedupeDonorRows<
  T extends { id?: string; name?: string; amount?: number; at?: number | string; message?: string },
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
  return Array.from(map.values());
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
  const members = (state.members || []).map((member) => {
    const bucket = totals.get(member.id) || { account: 0, toon: 0 };
    const isOperating = isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      state.memberPositions || null
    );
    return {
      ...member,
      account: bucket.account,
      toon: bucket.toon,
      contribution: isOperating ? Math.max(0, Number(member.contribution) || 0) : bucket.account + bucket.toon,
    };
  });
  return { ...state, members };
}

/** 이중 경로로 다른 fp- id 가 들어와도 같은 내용이면 단기로 중복 처리 */
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
    const anon = (n: string) => n === "익명" || n === "anonymous" || n === "anon";
    if (anon(nameA) || anon(nameB)) return true;
  }
  return false;
}

/** 동일 투네·계좌 후원 id가 이미 donors에 있으면 중복(연속 동일 금액·닉은 창 밖이면 별도 건으로 허용) */
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
  };
  const probeKey = donorRowDedupeKey(probeDonor);
  const contentKey = donationContentMatchKey({
    donorName: rawEvent.donorName,
    amount: rawEvent.amount,
    target: rawEvent.target,
    message: rawEvent.message,
  });
  const eventAt = toEpochMs(rawEvent.at);

  return donors.some((d) => {
    const donorId = String(d.id || "").trim();
    if (!donorId) return false;
    if (donorRowDedupeKey(d) === probeKey) return true;
    if (donorId === eventId || donorId === baseId) return true;
    if (baseId && normalizeDonationEventId(donorId) === baseId) return true;
    if (externalDonorId && (donorId === externalDonorId || normalizeDonationEventId(donorId) === externalDonorId)) {
      return true;
    }
    /** 서버 WS + 브라우저 릴레이 등이 서로 다른 unique id 로 들어올 때 */
    if (
      donationContentMatchKey(d) === contentKey &&
      Math.abs(donorAtEpochMs(d) - eventAt) <= DONATION_NEAR_DUP_WINDOW_MS
    ) {
      return true;
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
      /** 유사 일치 실패 시 운영비→대표→국고 자동 배치 */
      autoAssignToonPlayer: true,
      memberPositions: currentState.memberPositions,
    });
  }
  if (!processedEvent.memberId) {
    return { ok: false, reason: "unmatched", event: { ...processedEvent, status: "unmatched" } };
  }

  const newDonor = {
    id: processedEvent.id,
    name: processedEvent.donorName,
    amount: Math.max(0, Math.round(Number(processedEvent.amount) || 0)),
    memberId: processedEvent.memberId,
    at: processedEvent.at,
    target: processedEvent.target || "toon",
    ...(String(processedEvent.message || "").trim()
      ? { message: String(processedEvent.message).trim() }
      : {}),
  };
  const atMs = toEpochMs(processedEvent.at);

  const updatedMembers = currentState.members.map((member) => {
    if (member.id !== newDonor.memberId) return member;
    const field = newDonor.target === "toon" ? "toon" : "account";
    const nextAccount = field === "account" ? (member.account || 0) + newDonor.amount : (member.account || 0);
    const nextToon = field === "toon" ? (member.toon || 0) + newDonor.amount : (member.toon || 0);
    const isOperating = isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      currentState.memberPositions || null
    );
    return {
      ...member,
      [field]: (member[field] || 0) + newDonor.amount,
      contribution: isOperating ? Math.max(0, Number(member.contribution) || 0) : nextAccount + nextToon,
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
    members: updatedMembers,
    donors: [
      ...existingDonors,
      {
        id: newDonor.id,
        name: newDonor.name,
        amount: newDonor.amount,
        memberId: newDonor.memberId,
        at: atMs,
        target: newDonor.target,
        ...(newDonor.message ? { message: newDonor.message } : {}),
        ...(processedEvent.memberAutoAssigned ? { memberAutoAssigned: true } : {}),
      },
    ],
    mealBattle: {
      ...currentState.mealBattle,
      participants: mealParticipants,
    },
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    state: updatedState,
    event: { ...processedEvent, memberId: processedEvent.memberId, status: "processed" },
  };
}

/** 후원 기록 삭제 시 멤버·식대전·후원 순위 revision 되돌림 */
export function revertDonationFromAppState(currentState: AppState, donorId: string): AppState | null {
  const donor = (currentState.donors || []).find((d) => d.id === donorId);
  if (!donor) return null;
  if (isDonorExcludedFromDonationTotals(donor)) return null;

  const field = (donor.target || "account") === "toon" ? "toon" : "account";
  const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
  const atMs = Number.isFinite(Number(donor.at)) ? Math.max(0, Math.floor(Number(donor.at))) : Date.now();

  const members = currentState.members.map((member) => {
    if (member.id !== donor.memberId) return member;
    const nextAccount =
      field === "account" ? Math.max(0, (member.account || 0) - amount) : member.account || 0;
    const nextToon = field === "toon" ? Math.max(0, (member.toon || 0) - amount) : member.toon || 0;
    const isOperating = isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      currentState.memberPositions || null
    );
    return {
      ...member,
      [field]: Math.max(0, (member[field] || 0) - amount),
      contribution: isOperating ? Math.max(0, Number(member.contribution) || 0) : nextAccount + nextToon,
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
  return syncMemberTotalsFromDonors({
    ...currentState,
    donors: nextDonors,
    members,
    mealBattle: {
      ...currentState.mealBattle,
      participants: mealParticipants,
    },
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });
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

  const now = Date.now();
  const nextDonors = (currentState.donors || []).map((d) =>
    d.id === donorId ? { ...d, memberId: targetMemberId } : d
  );

  return syncMemberTotalsFromDonors({
    ...currentState,
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
