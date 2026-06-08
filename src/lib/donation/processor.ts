import { loadStateFromApi, saveStateAsync } from "@/lib/state";
import { createModuleLogger } from "@/lib/logger";
import type { AppState } from "@/types";
import { applyDonationToAppState } from "./apply-donation-state";
import type { DonationEvent, DonorAlias } from "./types";

const log = createModuleLogger("Donation/Processor");

const processedEventIds = new Set<string>();
const unresolvedEventIds = new Set<string>();
let aliasCache: DonorAlias[] = [];
let aliasCacheAt = 0;

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
    const applied = applyDonationToAppState(currentState, rawEvent, aliases);

    if (!applied.ok) {
      if (applied.reason === "duplicate") {
        processedEventIds.add(dedupeKey);
        return { ...rawEvent, status: "processed" as const };
      }
      log.warn("unmatched donor", applied.event.donorName);
      if (!unresolvedEventIds.has(dedupeKey)) {
        unresolvedEventIds.add(dedupeKey);
        await saveUnmatched(applied.event, userId);
      }
      return applied.event;
    }

    const saved = await saveCurrentAppState(applied.state, userId);
    if (!saved.ok) {
      return { ...rawEvent, status: "failed" as const, error: "state_save_failed" };
    }
    processedEventIds.add(dedupeKey);
    unresolvedEventIds.delete(dedupeKey);
    await resolveUnmatched(applied.event.id, userId);
    log.debug("processed", applied.event.donorName, applied.event.amount);
    return { ...applied.event, status: "processed" as const, updatedState: applied.state };
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

/** 별칭 저장 직후 수동 반영이 캐시된 목록을 쓰지 않게 */
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
