import {
  applyDonationToAppState,
  isDuplicateDonationEvent,
} from "@/lib/donation/apply-donation-state";
import { normalizeDonationEventId } from "@/domain/dedupe/donation-dedupe.rules";
import type { DonationEvent, DonorAlias } from "@/lib/donation/types";
import type { AppState } from "@/types";

const RESET_DISCARD_BUFFER_MS = 500;

export function ingestEventTimeMs(event: DonationEvent): number {
  const t = Date.parse(String(event.at || ""));
  return Number.isFinite(t) && t > 0 ? t : 0;
}

export function shouldDiscardIngestEventForReset(
  event: DonationEvent,
  settlementResetAt: number,
  intentionalClearAt: number
): boolean {
  const cutoff = Math.max(Number(settlementResetAt) || 0, Number(intentionalClearAt) || 0);
  if (cutoff <= 0) return false;
  const at = ingestEventTimeMs(event);
  if (at <= 0) return false;
  return at < cutoff - RESET_DISCARD_BUFFER_MS;
}

type LedgerDonor = { id?: string; externalId?: string; amount?: number };

/** 저장본 donors 에 이 이벤트의 UID(외부 ID)가 실제로 있는지. 금액이 달라도 UID가 같으면 있는 것으로 본다. */
export function eventMatchesDonorLedger(event: DonationEvent, donors: LedgerDonor[]): boolean {
  const core = normalizeDonationEventId(String(event.id || "")).trim().toLowerCase();
  const ext = String(event.externalId || "").trim().toLowerCase();
  if (!core && !ext) return false;
  for (const donor of donors) {
    const id = String(donor.id || "").trim();
    const donorCore = normalizeDonationEventId(id).trim().toLowerCase();
    const donorExt = String(donor.externalId || "").trim().toLowerCase();
    if (core && donorCore && core === donorCore) return true;
    if (ext && donorExt && ext === donorExt) return true;
    if (ext && donorCore === ext) return true;
    if (core && donorExt === core) return true;
  }
  return false;
}

export type FoldIngestResult = {
  state: AppState;
  applied: DonationEvent[];
  duplicates: number;
  discardedReset: number;
  unmatched: DonationEvent[];
};

/** 정산표(AppState.donors)에 올리기 전: 리셋 폐기 → 중복 제거 → 순차 반영. 저장은 호출측에서 1회. */
export function foldIngestEventsIntoState(
  currentState: AppState,
  events: DonationEvent[],
  aliases: DonorAlias[] = []
): FoldIngestResult {
  let state = currentState;
  const applied: DonationEvent[] = [];
  const unmatched: DonationEvent[] = [];
  let duplicates = 0;
  let discardedReset = 0;
  const resetAt = Number(state.settlementResetAt || 0);
  const clearAt = Number(
    (state as { intentionalDonationClearAt?: number }).intentionalDonationClearAt || 0
  );

  for (const event of events) {
    if (shouldDiscardIngestEventForReset(event, resetAt, clearAt)) {
      discardedReset += 1;
      continue;
    }
    if (isDuplicateDonationEvent(state, event)) {
      duplicates += 1;
      continue;
    }
    const result = applyDonationToAppState(state, event, aliases);
    if (!result.ok) {
      if (result.reason === "duplicate") {
        duplicates += 1;
        continue;
      }
      unmatched.push(result.event);
      continue;
    }
    state = result.state;
    applied.push(result.event);
  }

  return { state, applied, duplicates, discardedReset, unmatched };
}
