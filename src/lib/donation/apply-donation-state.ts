import { applyMealBattleDonationToParticipants } from "@/lib/meal-battle-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import type { AppState } from "@/types";
import { mapToMember } from "./mapper";
import type { DonationEvent, Donor, DonorAlias } from "./types";

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

/** parse-event fallback id (`${Date.now()}-${amount}`) — 동일 후원이 다른 id로 두 번 들어올 수 있음 */
export function isWeakToonationDonorId(id: string): boolean {
  const base = normalizeDonationEventId(String(id || "").trim()).replace(/^toonation:/i, "");
  return /^\d{10,13}-\d+$/.test(base);
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

export function dedupeDonorRows<T extends { id?: string; name?: string; amount?: number; at?: number | string }>(
  donors: T[]
): T[] {
  const map = new Map<string, T>();
  for (const d of donors) {
    const key = donorRowDedupeKey(d);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, d);
      continue;
    }
    if (donorAtEpochMs(d) >= donorAtEpochMs(prev)) map.set(key, d);
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

/** 동일 투네 후원이 다른 id(검토 큐·타임스탬프 fallback)로 다시 들어오는 것 방지 */
export function isDuplicateDonationEvent(state: AppState, rawEvent: DonationEvent): boolean {
  const donors = state.donors || [];
  const eventId = String(rawEvent.id || "").trim();
  const baseId = normalizeDonationEventId(eventId);
  const externalId = String(rawEvent.externalId || "").trim();
  const externalDonorId = externalId && rawEvent.provider ? `${rawEvent.provider}:${externalId}` : "";

  return donors.some((d) => {
    const donorId = String(d.id || "").trim();
    if (!donorId) return false;
    if (donorId === eventId || donorId === baseId) return true;
    if (baseId && normalizeDonationEventId(donorId) === baseId) return true;
    if (externalDonorId && (donorId === externalDonorId || normalizeDonationEventId(donorId) === externalDonorId)) {
      return true;
    }
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
      /** 당분간 멤버 1명 운영 — 계좌 포맷 오류·플레이어 없음도 즉시 반영 후 큐에서 멤버만 검토 */
      autoAssignToonPlayer: true,
    });
  }
  if (!processedEvent.memberId) {
    return { ok: false, reason: "unmatched", event: { ...processedEvent, status: "unmatched" } };
  }

  const newDonor: Donor = {
    id: processedEvent.id,
    name: processedEvent.donorName,
    amount: Math.max(0, Math.round(Number(processedEvent.amount) || 0)),
    memberId: processedEvent.memberId,
    at: processedEvent.at,
    target: processedEvent.target || "toon",
  };
  const atMs = toEpochMs(newDonor.at);

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
  const mealParticipants =
    syncMode === "mealBattle"
      ? applyMealBattleDonationToParticipants(
          currentState.mealBattle?.participants || [],
          newDonor.memberId,
          newDonor.amount,
          1,
          atMs
        )
      : (currentState.mealBattle?.participants || []);

  const now = Date.now();
  const updatedState = syncMemberTotalsFromDonors({
    ...currentState,
    members: updatedMembers,
    donors: [
      ...(currentState.donors || []),
      {
        id: newDonor.id,
        name: newDonor.name,
        amount: newDonor.amount,
        memberId: newDonor.memberId,
        at: atMs,
        target: newDonor.target,
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
  const mealParticipants =
    syncMode === "mealBattle"
      ? applyMealBattleDonationToParticipants(
          currentState.mealBattle?.participants || [],
          donor.memberId,
          amount,
          -1,
          atMs
        )
      : currentState.mealBattle?.participants || [];

  const now = Date.now();
  return syncMemberTotalsFromDonors({
    ...currentState,
    donors: (currentState.donors || []).filter((d) => d.id !== donorId),
    members,
    mealBattle: {
      ...currentState.mealBattle,
      participants: mealParticipants,
    },
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });
}
