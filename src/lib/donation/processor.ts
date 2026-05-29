import { loadStateFromApi, saveStateAsync } from "@/lib/state";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { applyMealBattleDonationToParticipants } from "@/lib/meal-battle-donation";
import { createModuleLogger } from "@/lib/logger";
import type { AppState, Donor as AppDonor } from "@/types";
import { mapToMember } from "./mapper";
import type { DonationEvent, Donor, DonorAlias } from "./types";

const log = createModuleLogger("Donation/Processor");

const processedEventIds = new Set<string>();
const unresolvedEventIds = new Set<string>();
let aliasCache: DonorAlias[] = [];
let aliasCacheAt = 0;

function toEpochMs(input: string): number {
  const ts = Date.parse(input);
  return Number.isFinite(ts) ? ts : Date.now();
}

function toAppDonor(donor: Donor): AppDonor {
  return {
    id: donor.id,
    name: donor.name,
    amount: donor.amount,
    memberId: donor.memberId,
    at: toEpochMs(donor.at),
    target: donor.target,
  };
}

export type ProcessDonationResult = DonationEvent & { updatedState?: AppState };

/** 관리자 화면의 식대전·동기화 모드는 서버보다 최신일 수 있음 — 후원 반영 시 우선 */
function mergeAdminHintForDonation(server: AppState, hint?: AppState | null): AppState {
  if (!hint) return server;
  return {
    ...server,
    mealBattle: hint.mealBattle ?? server.mealBattle,
    donationSyncMode: hint.donationSyncMode ?? server.donationSyncMode,
  };
}

export async function processDonationEvent(
  rawEvent: DonationEvent,
  userId?: string,
  hintState?: AppState | null
): Promise<ProcessDonationResult> {
  log.debug("processing", rawEvent.donorName, rawEvent.amount);
  try {
    const dedupeKey = `${rawEvent.provider}:${rawEvent.externalId || rawEvent.id}`;
    if (processedEventIds.has(dedupeKey)) {
      return { ...rawEvent, status: "processed" as const };
    }

    const loaded = await getCurrentAppState(userId);
    if (!loaded) {
      return { ...rawEvent, status: "failed" as const, error: "state_not_available" };
    }
    const currentState = mergeAdminHintForDonation(loaded, hintState);

    const aliases = await loadAliases(userId);
    const processedEvent = mapToMember(rawEvent, currentState.members || [], aliases);
    if (processedEvent.status === "unmatched" || !processedEvent.memberId) {
      log.warn("unmatched donor", processedEvent.donorName);
      if (!unresolvedEventIds.has(dedupeKey)) {
        unresolvedEventIds.add(dedupeKey);
        await saveUnmatched(processedEvent, userId);
      }
      return processedEvent;
    }

    if ((currentState.donors || []).some((d) => d.id === processedEvent.id)) {
      processedEventIds.add(dedupeKey);
      return { ...processedEvent, status: "processed" as const };
    }

    const newDonor: Donor = {
      id: processedEvent.id,
      name: processedEvent.donorName,
      amount: Math.max(0, Math.round(Number(processedEvent.amount) || 0)),
      memberId: processedEvent.memberId,
      at: processedEvent.at,
      target: processedEvent.target || "toon",
    };
    const appDonor = toAppDonor(newDonor);

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
        /** 관리자 수동 후원과 동일하게 기여도 합계를 맞춤. 운영비 행은 기여도 책정 제외 */
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
            appDonor.at
          )
        : (currentState.mealBattle?.participants || []);

    const updatedState: AppState = {
      ...currentState,
      members: updatedMembers,
      donors: [...(currentState.donors || []), appDonor],
      mealBattle: {
        ...currentState.mealBattle,
        participants: mealParticipants,
      },
      updatedAt: Date.now(),
    };

    const saved = await saveCurrentAppState(updatedState, userId);
    if (!saved.ok) {
      return { ...rawEvent, status: "failed" as const, error: "state_save_failed" };
    }
    processedEventIds.add(dedupeKey);
    unresolvedEventIds.delete(dedupeKey);
    await resolveUnmatched(processedEvent.id, userId);
    log.debug("processed", newDonor.name, newDonor.amount);
    return { ...processedEvent, status: "processed" as const, updatedState };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    log.error("process failed", message);
    return { ...rawEvent, status: "failed" as const, error: message };
  }
}

async function getCurrentAppState(userId?: string): Promise<AppState | null> {
  return loadStateFromApi(userId);
}

async function saveCurrentAppState(
  state: AppState,
  userId?: string
): Promise<{ ok: boolean }> {
  if (typeof window === "undefined") return { ok: false };
  const result = await saveStateAsync(state, userId);
  return { ok: Boolean(result.ok) };
}

async function saveUnmatched(event: DonationEvent, userId?: string): Promise<void> {
  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  await fetch(`/api/donations/unmatched${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...event, status: "unmatched" }),
  }).catch(() => {});
}

async function resolveUnmatched(id: string, userId?: string): Promise<void> {
  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  await fetch(`/api/donations/unmatched/resolve${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).catch(() => {});
}

async function loadAliases(userId?: string): Promise<DonorAlias[]> {
  const now = Date.now();
  if (aliasCacheAt > 0 && now - aliasCacheAt < 15000) {
    return aliasCache;
  }
  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  const res = await fetch(`/api/donations/aliases${q}`, { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) {
    aliasCacheAt = Date.now();
    return aliasCache;
  }
  try {
    const data = (await res.json()) as { items?: DonorAlias[] };
    aliasCache = Array.isArray(data.items) ? data.items : [];
  } catch {
    /* keep previous aliasCache */
  }
  aliasCacheAt = Date.now();
  return aliasCache;
}
