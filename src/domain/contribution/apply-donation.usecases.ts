import type { AppState, Donor, ContributionFormula, ContributionLog } from "@/types";
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
import { computeContributionPoints, normalizeContributionFormula } from "@/lib/contribution-formula";
import { mapToMember } from "@/lib/donation/mapper";
import type { DonationEvent, DonorAlias } from "@/lib/donation/types";
import {
  dedupeDonorRows,
  donationQueueIdsForDonor,
  isDuplicateDonationEvent,
  isDonorExcludedFromDonationTotals,
} from "@/domain/dedupe/donation-dedupe.pipeline";
import {
  aggregateContribLogsByMember,
  aggregateContributionByMember,
  mergeContributionFormulaIntoState,
  resolveApplyContributionContext,
  resolveMemberContributionTotal,
  syncMemberTotalsFromDonors,
} from "@/domain/sync/sync-repair-1pass";

export type ApplyDonationResult =
  | { ok: true; state: AppState; event: DonationEvent }
  | { ok: false; reason: "unmatched" | "duplicate" | "paused"; event: DonationEvent };

function toEpochMs(input: string): number {
  const ts = Date.parse(input);
  return Number.isFinite(ts) ? ts : Date.now();
}

function memberHasContributionSources(
  memberId: string,
  state: Pick<AppState, "donors" | "contributionLogs">,
  opts?: { dedupedDonors?: Donor[] }
): boolean {
  const id = String(memberId || "").trim();
  if (!id) return false;
  const deduped = opts?.dedupedDonors ?? dedupeDonorRows(state.donors || []);
  const hasDonor = deduped.some(
    (d) =>
      !isDonorExcludedFromDonationTotals(d) &&
      String(d.memberId || "").trim() === id
  );
  if (hasDonor) return true;
  return (state.contributionLogs || []).some(
    (log) => String(log.memberId || "").trim() === id
  );
}

export {
  mergeContributionFormulaIntoState,
  resolveApplyContributionContext,
  donationQueueIdsForDonor,
};

export function applyDonationToAppState(
  currentState: AppState,
  rawEvent: DonationEvent,
  aliases: DonorAlias[] = []
): ApplyDonationResult {
  if (isDuplicateDonationEvent(currentState, rawEvent)) {
    return { ok: false, reason: "duplicate", event: rawEvent };
  }

  const manualMemberId = String((rawEvent as { manualAssignMemberId?: string }).manualAssignMemberId || "").trim();
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
      autoAssignToonPlayer: true,
      memberPositions: currentState.memberPositions,
    });
  }
  if (!processedEvent.memberId) {
    return {
      ok: false,
      reason: "unmatched",
      event: { ...processedEvent, status: "unmatched" },
    };
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
  const atMs = toEpochMs(String(processedEvent.at || ""));
  const formulaState = mergeContributionFormulaIntoState(currentState, processedEvent);
  const { formula, contributionPoints } = resolveApplyContributionContext(
    formulaState,
    processedEvent,
    newDonor.amount,
    newDonor.target as "account" | "toon"
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
      : currentState.mealBattle?.participants || [];

  const now = Date.now();
  const existingDonors = currentState.donors || [];
  if (
    existingDonors.some(
      (d) => String(d.id || "").trim() === String(newDonor.id || "").trim()
    )
  ) {
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
        ...((processedEvent as { memberAutoAssigned?: boolean }).memberAutoAssigned
          ? { memberAutoAssigned: true }
          : {}),
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

export function revertDonationFromAppState(
  currentState: AppState,
  donorId: string,
  opts?: { hardDeleteRow?: boolean }
): AppState | null {
  const donor = (currentState.donors || []).find((d) => d.id === donorId);
  if (!donor) return null;
  if (isDonorExcludedFromDonationTotals(donor) && !opts?.hardDeleteRow) return null;

  const field = resolveEffectiveDonorTarget(donor);
  const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
  const atMs = Number.isFinite(Number(donor.at))
    ? Math.max(0, Math.floor(Number(donor.at)))
    : Date.now();
  const formula = normalizeContributionFormula(currentState.contributionFormula);
  const storedPoints = Number(donor.contributionPoints);
  const overridePoints =
    Number.isFinite(storedPoints) && storedPoints >= 0
      ? Math.round(storedPoints)
      : computeContributionPoints(amount, field as "account" | "toon", formula);

  const syncMode = currentState.donationSyncMode || "mealBattle";
  const mealRaw = mealBattleUsesRawDonationScore(currentState.mealBattle);
  const mealParticipants =
    syncMode === "mealBattle" && !isDonorExcludedFromDonationTotals(donor)
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
  const idStr = String(donorId);
  const nameStr = String(donor.name || donorId);
  const memberIdStr = String(donor.memberId || "").trim();

  /**
   * ✅ FIX: 삭제 후 hub polling / SSE sync로 donor가 다시 나타나는 버그.
   * 기존: filter(d.id !== donorId) → DB에서 다시 로드하면 복원.
   * 변경: donationExcluded=true 플래그 마킹 + 기여도에서 제외.
   *       dedupe pipeline에서 preferred.donationExcluded || fallback.donationExcluded로 merge 유지되므로
   *       허브 sync·Redis 폴링·daily log restore 어디서 와도 영구적으로 집계 제외됨.
   * opts.hardDeleteRow=true 인 경우만 과거 호환성 위해 filter 삭제 유지.
   */
  const nextDonors: Donor[] = opts?.hardDeleteRow
    ? (currentState.donors || []).filter((d) => d.id !== donorId)
    : (currentState.donors || []).map((d): Donor => {
        if (d.id !== donorId) return d;
        return { ...(d as Donor), donationExcluded: true };
      });

  /** ✅ FIX: contributionLogs cleanup · 삭제 donor와 관련된 +delta 추가 로그를 함께 제거 (로그 오염 방지)
   * 1. donorId를 직접 참조하는 로그 (apply:{donorId} / revert:{donorId} / reassign:*:{donorId}:*)
   * 2. 동일 memberId + 동일 overridePoints amount + delta+1 인 추가 로그에서 1개 제거 (best-effort 페어 매칭)
   */
  let nextContributionLogs = [...(currentState.contributionLogs || [])];
  const directMatchRegex = new RegExp(`:(?:apply|revert|reassign)(?::[^:]*)*:${idStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?::|$)`);
  nextContributionLogs = nextContributionLogs.filter((log) => {
    if (directMatchRegex.test(log.id)) return false;
    if (log.note && (log.note.includes(`donor ${nameStr}`) || log.note.includes(`donor ${idStr}`))) return false;
    return true;
  });
  if (overridePoints > 0 && memberIdStr && !isDonorExcludedFromDonationTotals(donor)) {
    let consumed = false;
    nextContributionLogs = nextContributionLogs.filter((log) => {
      if (consumed) return true;
      if (
        log.memberId === memberIdStr &&
        log.delta === (1 as const) &&
        Math.abs(Number(log.amount) - overridePoints) < 0.5
      ) {
        consumed = true;
        return false;
      }
      return true;
    });
    /** delta:-1 revert push는 이제 불필요 (donationExcluded로 집계에서 이미 제외 & 멤버 합계 차감 직접 적용) */
  }

  const positions = currentState.memberPositions || null;
  const isOperating = (mid: string) =>
    isOperatingSettlementMember(
      (currentState.members || []).find((m) => m.id === mid) || {
        id: mid,
        name: "",
        operating: false,
      },
      positions
    );

  const members = (currentState.members || []).map((member) => {
    if (String(member.id) !== memberIdStr) return member;
    if (isOperating(member.id) || isDonorExcludedFromDonationTotals(donor)) return member;
    const fallbackContrib = Math.max(0, Number(member.contribution) || 0);
    const contribution = Math.max(0, fallbackContrib - overridePoints);
    const targetField = field === "toon" ? "toon" : "account";
    const oldTarget = Math.max(0, Number(member[targetField] as number | undefined) || 0);
    const target = Math.max(0, oldTarget - amount);
    return { ...member, contribution, [targetField]: target };
  });

  return syncHighSocietyMemberWidthSnapshotInState({
    ...currentState,
    donors: nextDonors,
    contributionLogs: nextContributionLogs,
    members,
    mealBattle: {
      ...currentState.mealBattle,
      participants: mealParticipants,
    },
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });
}

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
  const atMs = Number.isFinite(Number(donor.at))
    ? Math.max(0, Math.floor(Number(donor.at)))
    : Date.now();
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

  const now = Date.now();
  const logs: ContributionLog[] = [];
  if (contributionPoints > 0 && !isDonorExcludedFromDonationTotals(donor)) {
    const positions = currentState.memberPositions || null;
    const isOperating = (mid: string) =>
      isOperatingSettlementMember(
        (currentState.members || []).find((m) => m.id === mid) || {
          id: mid,
          name: "",
          operating: false,
        },
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
      return rest as Donor;
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
    hsPushDir === "left" || hsPushDir === "right" || hsPushDir === "split"
      ? hsPushDir
      : null;
  if (prev === nextDir) return null;
  const now = Date.now();
  const nextDonors = (currentState.donors || []).map((d): Donor => {
    if (d.id !== id) return d;
    if (!nextDir) {
      const { hsPushDir: _drop, ...rest } = d;
      return rest as Donor;
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
  const nextDonors = (currentState.donors || []).map((d): Donor => {
    if (d.id !== id) return d;
    const { hsPushDir: _drop, ...rest } = d;
    if (!wantOverride) return rest as Donor;
    return { ...rest, hsPushDir: wantOverride };
  });

  return syncHighSocietyMemberWidthSnapshotInState({
    ...currentState,
    donors: nextDonors,
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });
}

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
    !isDonationAmountEligibleForHighSocietyTerritory(
      Math.max(0, Number(donor.amount) || 0)
    )
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

export function clearAllDonorHsPushDirs(currentState: AppState): AppState {
  let changed = false;
  const nextDonors = (currentState.donors || []).map((d): Donor => {
    if (!d.hsPushDir) return d;
    changed = true;
    const { hsPushDir: _drop, ...rest } = d;
    return rest as Donor;
  });
  if (!changed) return currentState;
  return {
    ...currentState,
    donors: nextDonors,
    updatedAt: Date.now(),
  };
}
