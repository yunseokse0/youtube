import type { AppState } from "@/lib/state";
import type { Member } from "@/types";
import {
  normalizeDonorsArray,
  totalCombined,
  hasMeaningfulMemberRoster,
  isDefaultPlaceholderMemberList,
} from "@/lib/state";
import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { isRedisConfigured } from "@/app/api/_shared/upstash";
import { isMysqlKvConfigured } from "@/app/api/_shared/mysql-kv";

export const STORAGE_KEY_BASE = "excel-broadcast-state-v1";
export const STORAGE_KEY_LEGACY = "excel-broadcast-state-v1";

export const HDR_STATE_STORAGE = "X-Broadcast-State-Storage";

export function overlayPickEnabled(): boolean {
  const v = process.env.STATE_API_OVERLAY_PICK?.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

export function persistentStateStorageHeader(): string {
  if (isMysqlKvConfigured() && !isRedisConfigured()) return "mysql";
  if (isRedisConfigured()) return "redis";
  return "memory";
}

export function getUserId(req: Request): string | null {
  return getUserIdFromRequest(req);
}

export function stateKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
}

export function parseFastHydrateParam(req: Request): boolean {
  try {
    return new URL(req.url).searchParams.get("fast") === "1";
  } catch {
    return false;
  }
}

export function parseSinceParam(req: Request): number {
  try {
    const n = Number(new URL(req.url).searchParams.get("since") || 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function hasWarmServerState(state: AppState | null | undefined): state is AppState {
  if (!state) return false;
  return (
    normalizeDonorsArray(state.donors).length > 0 ||
    totalCombined(state) > 0 ||
    hasMeaningfulMemberRoster(state)
  );
}

export function stateNotModifiedResponse(storage: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      "Cache-Control": "no-store, max-age=0, s-maxage=0",
      [HDR_STATE_STORAGE]: storage,
    },
  });
}

export function stateUnavailableResponse(reason: string): Response {
  return new Response(JSON.stringify({ error: "state_unavailable", reason, retry: true }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0, s-maxage=0",
      [HDR_STATE_STORAGE]: "unavailable",
    },
  });
}

export function memberCombinedTotal(members: Member[] | undefined): number {
  return (members || []).reduce((sum, m) => sum + (m.account || 0) + (m.toon || 0), 0);
}

export function looksLikeEmptyRosterPersist(
  body: Partial<AppState> & { membersAuthoritative?: boolean },
  donorsInPatch: boolean,
  incomingDonorCount: number
): boolean {
  const donorsEmpty = !donorsInPatch || incomingDonorCount === 0;
  if (!donorsEmpty) return false;
  if (!("members" in body)) return incomingDonorCount === 0 && donorsInPatch;
  const members = body.members;
  if (!Array.isArray(members)) return true;
  if (isDefaultPlaceholderMemberList(members)) return true;
  if (hasMeaningfulMemberRoster({ members } as AppState)) return false;
  if (body.membersAuthoritative === true) return false;
  return memberCombinedTotal(members) === 0;
}
