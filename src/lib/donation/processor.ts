import { loadStateFromApi, saveStateAsync } from "@/lib/state";
import { mergeDonationApplyBase } from "./merge-donation-apply-base";
import { createModuleLogger } from "@/lib/logger";
import type { AppState } from "@/types";
import { applyDonationToAppState, isDuplicateDonationEvent } from "./apply-donation-state";
import { donationApplyPrimaryKey } from "./donation-dedupe-keys";
import { resolveToonationDonationWithOwnerRemap } from "./toonation/owner-donation-remap";
import type { DonationEvent, DonorAlias } from "./types";

const log = createModuleLogger("Donation/Processor");

const processedEventIds = new Set<string>();
const unresolvedEventIds = new Set<string>();
let aliasCache: DonorAlias[] = [];
let aliasCacheAt = 0;

export type ProcessDonationResult = DonationEvent & {
  updatedState?: AppState;
};

/** 관리자 화면의 식대전·동기화 모드는 서버보다 최신일 수 있음 — 후원 반영 시 우선 */
function mergeAdminHintForDonation(server: AppState, hint?: AppState | null): AppState {
  if (!hint) return server;
  return {
    ...server,
    mealBattle: hint.mealBattle ?? server.mealBattle,
    donationSyncMode: hint.donationSyncMode ?? server.donationSyncMode,
  };
}

/** 후원 반영 — GET이 빈 donors·placeholder 멤버일 때 관리자 stateRef 기준으로 보정 */
function mergeAdminHintForDonationApply(server: AppState, hint?: AppState | null): AppState {
  return mergeDonationApplyBase(server, hint) ?? server;
}

export type ProcessDonationOptions = {
  /** 관리자 「채널 주인명」 — 후원자 닉과 같으면 계좌 처리 */
  ownerName?: string;
};

export async function processDonationEvent(
  rawEvent: DonationEvent,
  userId?: string,
  hintState?: AppState | null,
  options?: ProcessDonationOptions
): Promise<ProcessDonationResult> {
  const uid = userId || "__default__";
  let event =
    rawEvent.provider === "toonation" && userId
      ? await resolveToonationDonationWithOwnerRemap(uid, rawEvent, options?.ownerName)
      : rawEvent;
  log.debug("processing", event.donorName, event.amount);
  try {
    const dedupeKey = donationApplyPrimaryKey(uid, event);
    if (processedEventIds.has(dedupeKey)) {
      return { ...event, status: "processed" as const };
    }

    const loaded = await loadStateFromApi(userId, { forceFull: true });
    if (!loaded) {
      return { ...event, status: "failed" as const, error: "state_not_available" };
    }
    const currentState = mergeAdminHintForDonationApply(
      mergeAdminHintForDonation(loaded, hintState),
      hintState
    );
    const aliases = await loadAliases(userId);

    let applied = applyDonationToAppState(currentState, event, aliases);

    if (!applied.ok) {
      if (applied.reason === "duplicate") {
        processedEventIds.add(dedupeKey);
        return { ...event, status: "processed" as const };
      }
      log.warn("unmatched donor", applied.event.donorName);
      if (!unresolvedEventIds.has(dedupeKey)) {
        unresolvedEventIds.add(dedupeKey);
        await saveUnmatched(applied.event, userId);
      }
      return applied.event;
    }

    const beforeSave = await getCurrentAppState(userId);
    if (beforeSave && isDuplicateDonationEvent(beforeSave, event)) {
      processedEventIds.add(dedupeKey);
      return { ...event, status: "processed" as const, updatedState: beforeSave };
    }

    const saved = await saveCurrentAppState(applied.state, userId, { donorsAuthoritative: true });
    if (!saved.ok) {
      return { ...event, status: "failed" as const, error: "state_save_failed" };
    }
    processedEventIds.add(dedupeKey);
    unresolvedEventIds.delete(dedupeKey);
    await resolveUnmatched(applied.event.id, userId);
    log.debug("processed", applied.event.donorName, applied.event.amount);
    return { ...applied.event, status: "processed" as const, updatedState: applied.state };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    log.error("process failed", message);
    return { ...event, status: "failed" as const, error: message };
  }
}

async function getCurrentAppState(userId?: string): Promise<AppState | null> {
  return loadStateFromApi(userId);
}

async function saveCurrentAppState(
  state: AppState,
  userId?: string,
  options?: { donorsAuthoritative?: boolean }
): Promise<{ ok: boolean }> {
  if (typeof window === "undefined") return { ok: false };
  const result = await saveStateAsync(state, userId, options);
  return { ok: Boolean(result.ok) };
}

/** 별칭 저장 직후 자동 반영이 캐시된 목록을 쓰지 않게 */
export function invalidateDonationAliasCache(): void {
  aliasCacheAt = 0;
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

async function saveUnmatched(event: DonationEvent, userId?: string): Promise<void> {
  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  await fetch(`/api/donations/unmatched${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...event, status: "unmatched" }),
  }).catch(() => {});
}

async function resolveUnmatched(eventId: string, userId?: string): Promise<void> {
  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  await fetch(`/api/donations/unmatched/resolve${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: eventId }),
  }).catch(() => {});
}
