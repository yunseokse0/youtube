import type { AppState } from "@/lib/state";
import {
  defaultState,
  ensureMembers,
  normalizeSigMatchParticipantIds,
  normalizeSigMatchPools,
} from "@/lib/state";

/** URL snap / snapKey → 시그 대전 집계에 필요한 필드만 병합 */
export function snapshotToSigMatchState(raw: Record<string, unknown> | null): AppState | null {
  if (!raw || !Array.isArray(raw.members)) return null;
  const base = defaultState();
  const members = ensureMembers(raw.members as AppState["members"]);
  if (members.length === 0) return null;
  const merged: AppState = {
    ...base,
    ...raw,
    members,
    donors: Array.isArray(raw.donors) ? (raw.donors as AppState["donors"]) : [],
    sigMatch: raw.sigMatch && typeof raw.sigMatch === "object" ? (raw.sigMatch as AppState["sigMatch"]) : {},
    sigMatchSettings: {
      ...base.sigMatchSettings,
      ...(typeof raw.sigMatchSettings === "object" && raw.sigMatchSettings
        ? (raw.sigMatchSettings as AppState["sigMatchSettings"])
        : {}),
    },
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
  const valid = new Set(merged.members.map((m) => m.id));
  merged.sigMatchSettings = {
    ...merged.sigMatchSettings,
    sigMatchPools: normalizeSigMatchPools(merged.sigMatchSettings.sigMatchPools, valid),
    participantMemberIds: normalizeSigMatchParticipantIds(merged.sigMatchSettings.participantMemberIds, valid),
  };
  return merged;
}
