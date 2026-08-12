import {
  DEFAULT_DONOR_RANKINGS_FULL_THEME,
  hasMeaningfulMemberRoster,
  isDefaultLikeDonorRankingsTheme,
  isIntentionalDonorListShrink,
  normalizeDonorsArray,
  pickOverlayPresetsPreferCustom,
  shouldBlockAccidentalEmptyOverwrite,
} from "@/lib/state";
import type { AppState, Donor, Member } from "@/types";
import {
  mergeDonorRowFields,
  repairMemberTotalsForDonorRoster,
  rosterDonorMatchScore,
  syncMemberTotalsFromDonors,
} from "./apply-donation-state";
import { isGroupSplitPartDonor } from "./group-split-donation";

export { rosterDonorMatchScore } from "./apply-donation-state";

/** 단체짠 split·원본 행이 incoming 쪽에서 빠져도 union 에 남게 보강 */
function unionGroupSplitDonorsIntoMap(
  donorMap: Map<string, Donor>,
  ...lists: Donor[][]
): void {
  for (const list of lists) {
    for (const d of list) {
      if (!isGroupSplitPartDonor(d) && !d.groupSplitSource) continue;
      const prev = donorMap.get(d.id);
      donorMap.set(d.id, prev ? mergeDonorRowFields(d, prev) : d);
    }
  }
}

/** split 행 memberId 가 로스터에 얼마나 매칭되는지 — 동점 로스터 선택용 */
function groupSplitRosterMatchScore(
  members: Member[] | null | undefined,
  donors: Donor[] | null | undefined
): number {
  const ids = new Set((members || []).map((m) => String(m.id || "").trim()).filter(Boolean));
  if (ids.size === 0) return 0;
  let score = 0;
  for (const d of donors || []) {
    if (!isGroupSplitPartDonor(d)) continue;
    const mid = String(d.memberId || "").trim();
    if (!mid || !ids.has(mid)) continue;
    score += Math.max(0, Math.round(Number(d.amount) || 0));
  }
  return score;
}

/**
 * 후원 반영 — 서버 GET(빈 donors·placeholder)이 관리자 화면 stateRef 를 덮지 않게 병합.
 * id 기준 union, 동일 id는 hint(화면) 우선.
 * 멤버 금액은 병합된 donors 기준으로 재계산(힌트 멤버가 최신 후원을 덮어쓰지 않게).
 * 로스터는 donors.memberId 매칭 점수가 높은 쪽을 씀(서버·화면 id 불일치 시 엑셀 0 방지).
 */
export function mergeDonationApplyBase(
  fresh: AppState | null | undefined,
  hint: AppState | null | undefined
): AppState | null {
  if (!hint && !fresh) return null;
  if (!fresh) return hint ?? null;
  if (!hint) return fresh;

  const freshDonors = normalizeDonorsArray(fresh.donors);
  const hintDonors = normalizeDonorsArray(hint.donors);
  const donorMap = new Map<string, (typeof freshDonors)[number]>();
  for (const d of freshDonors) donorMap.set(d.id, d);
  for (const d of hintDonors) {
    const prev = donorMap.get(d.id);
    donorMap.set(d.id, prev ? mergeDonorRowFields(d, prev) : d);
  }
  unionGroupSplitDonorsIntoMap(donorMap, freshDonors, hintDonors);
  const mergedDonors = Array.from(donorMap.values()).sort((a, b) => b.at - a.at);

  const hintStrong = hasMeaningfulMemberRoster(hint);
  const freshStrong = hasMeaningfulMemberRoster(fresh);
  const hintScore = rosterDonorMatchScore(hint.members, mergedDonors);
  const freshScore = rosterDonorMatchScore(fresh.members, mergedDonors);
  let useHintRoster = false;
  if (hintStrong && !freshStrong) useHintRoster = true;
  else if (!hintStrong && freshStrong) useHintRoster = false;
  else if (hintStrong && freshStrong) {
    if (hintScore > freshScore) useHintRoster = true;
    else if (freshScore > hintScore) useHintRoster = false;
    else {
      const hintSplitScore = groupSplitRosterMatchScore(hint.members, mergedDonors);
      const freshSplitScore = groupSplitRosterMatchScore(fresh.members, mergedDonors);
      if (hintSplitScore > freshSplitScore) useHintRoster = true;
      else if (freshSplitScore > hintSplitScore) useHintRoster = false;
      else {
        const hintHasSplits = hintDonors.some(
          (d) => isGroupSplitPartDonor(d) || d.groupSplitSource
        );
        const freshHasSplits = freshDonors.some(
          (d) => isGroupSplitPartDonor(d) || d.groupSplitSource
        );
        if (hintHasSplits && !freshHasSplits) useHintRoster = true;
        else if (freshHasSplits && !hintHasSplits) useHintRoster = false;
        else useHintRoster = hintScore >= freshScore;
      }
    }
  }
  const rosterBase = useHintRoster ? hint : fresh;

  const donorRankingsTheme =
    !isDefaultLikeDonorRankingsTheme(hint.donorRankingsTheme) &&
    isDefaultLikeDonorRankingsTheme(fresh.donorRankingsTheme)
      ? hint.donorRankingsTheme
      : (hint.donorRankingsTheme ?? fresh.donorRankingsTheme);
  const donorRankingsFullTheme =
    !isDefaultLikeDonorRankingsTheme(hint.donorRankingsFullTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME) &&
    isDefaultLikeDonorRankingsTheme(fresh.donorRankingsFullTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME)
      ? hint.donorRankingsFullTheme
      : (hint.donorRankingsFullTheme ?? fresh.donorRankingsFullTheme);

  const merged: AppState = {
    ...fresh,
    ...hint,
    members: rosterBase.members,
    memberPositions: useHintRoster ? hint.memberPositions : fresh.memberPositions,
    memberPositionMode: hint.memberPositionMode ?? fresh.memberPositionMode,
    rankPositionLabels: hint.rankPositionLabels ?? fresh.rankPositionLabels,
    donors: mergedDonors,
    mealBattle: hint.mealBattle ?? fresh.mealBattle,
    donationSyncMode: hint.donationSyncMode ?? fresh.donationSyncMode,
    overlayPresets: pickOverlayPresetsPreferCustom(fresh.overlayPresets, hint.overlayPresets),
    donorRankingsTheme,
    donorRankingsFullTheme,
    donorRankingsPresets: hint.donorRankingsPresets?.length
      ? hint.donorRankingsPresets
      : fresh.donorRankingsPresets,
    donorRankingsPresetId: hint.donorRankingsPresetId ?? fresh.donorRankingsPresetId,
    /** hint 가 구 리셋 스탬프면 서버 최신 리셋을 덮어 분배 at 가 필터에 걸림 → max 유지 */
    settlementResetAt: Math.max(
      Number(fresh.settlementResetAt || 0),
      Number(hint.settlementResetAt || 0)
    ) || fresh.settlementResetAt || hint.settlementResetAt,
    overlaySettings: {
      ...((fresh.overlaySettings && typeof fresh.overlaySettings === "object"
        ? fresh.overlaySettings
        : {}) as Record<string, unknown>),
      ...((hint.overlaySettings && typeof hint.overlaySettings === "object"
        ? hint.overlaySettings
        : {}) as Record<string, unknown>),
    } as AppState["overlaySettings"],
    updatedAt: Math.max(Number(hint.updatedAt || 0), Number(fresh.updatedAt || 0)) || Date.now(),
  };
  const synced = syncMemberTotalsFromDonors(merged);
  return repairMemberTotalsForDonorRoster(synced, fresh, hint);
}

/**
 * donorsAuthoritative 저장 직전 — 빈 GET·지연 스냅샷만으로 엑셀표가 초기화되지 않게
 * 화면 hint·LS·서버 스냅샷 donors 를 union 한다.
 *
 * 중요: `applied`(방금 반영한 상태)를 hint 로 유지하고 sources 는 fresh 로만 쓴다.
 * 예전처럼 merge(applied, emptyApi) 하면 서버 로스터가 hint 가 되어
 * memberId 불일치 시 엑셀 금액이 전부 0 이 된다.
 */
export function enrichStateBeforeAuthoritativeDonationSave(
  applied: AppState,
  sources: Array<AppState | null | undefined>
): AppState {
  let next = applied;
  for (const src of sources) {
    if (!src) continue;
    next = mergeDonationApplyBase(src, next) ?? next;
  }
  return next;
}

/**
 * 정산 리셋(settlementResetAt 상승) 전에는 기존 donors 를 버리지 않고 incoming 과 union.
 * 투네 자동 반영이 수동 계좌 붙여넣기를 덮어쓰는 lost-update 방지.
 */
export function mergeStatePreservingDonorsUntilSettlementReset(
  incoming: AppState,
  existing: AppState | null | undefined
): AppState {
  if (!existing) return incoming;
  const incomingReset = Number(incoming.settlementResetAt || 0);
  const existingReset = Number(existing.settlementResetAt || 0);
  if (incomingReset > existingReset) {
    /** stamp만 앞서고 멤버1·2…/빈 후원이면 강제 리셋으로 취급하지 않음 */
    if (shouldBlockAccidentalEmptyOverwrite(existing, incoming)) {
      return {
        ...incoming,
        members: existing.members,
        memberPositions: existing.memberPositions ?? incoming.memberPositions,
        donors: normalizeDonorsArray(existing.donors),
        settlementResetAt: existing.settlementResetAt,
        updatedAt: Math.max(Number(incoming.updatedAt || 0), Number(existing.updatedAt || 0)) || Date.now(),
      };
    }
    return syncMemberTotalsFromDonors({
      ...incoming,
      settlementResetAt: incomingReset,
      donors: normalizeDonorsArray(incoming.donors),
    });
  }
  const incomingDonors = normalizeDonorsArray(incoming.donors);
  const existingDonors = normalizeDonorsArray(existing.donors);
  /** 수동 삭제 — union 하면 지운 행이 Redis·메모리에서 되살아 엑셀표가 꼬임 */
  if (
    incomingDonors.length > 0 &&
    existingDonors.length > incomingDonors.length &&
    isIntentionalDonorListShrink(
      incomingDonors,
      existingDonors,
      Number(incoming.updatedAt || 0),
      Number(existing.updatedAt || 0)
    )
  ) {
    const shrunk = syncMemberTotalsFromDonors({
      ...incoming,
      donors: incomingDonors,
      settlementResetAt: Math.max(incomingReset, existingReset) || incoming.settlementResetAt || existing.settlementResetAt,
      updatedAt: Math.max(Number(incoming.updatedAt || 0), Number(existing.updatedAt || 0)) || Date.now(),
    });
    return repairMemberTotalsForDonorRoster(shrunk, existing, incoming);
  }
  return mergeDonationApplyBase(incoming, existing) ?? incoming;
}

/**
 * donorsReplace·삭제·단체짠 — incoming donors 를 그대로 쓰고 shell(로스터·테마·타이머)만 병합.
 * union 경로와 달리 삭제·split 행이 Redis·메모리에서 되살아나지 않게 한다.
 */
export function mergeDonationReplaceForPersist(
  incoming: AppState,
  existing: AppState | null | undefined
): AppState {
  const incomingDonors = normalizeDonorsArray(incoming.donors);
  if (!existing) {
    const synced = syncMemberTotalsFromDonors({ ...incoming, donors: incomingDonors });
    return repairMemberTotalsForDonorRoster(synced, incoming);
  }
  const incomingReset = Number(incoming.settlementResetAt || 0);
  const existingReset = Number(existing.settlementResetAt || 0);
  if (incomingReset > existingReset) {
    if (shouldBlockAccidentalEmptyOverwrite(existing, incoming)) {
      return repairMemberTotalsForDonorRoster(
        syncMemberTotalsFromDonors({
          ...incoming,
          members: hasMeaningfulMemberRoster(existing) ? existing.members : incoming.members,
          memberPositions: existing.memberPositions ?? incoming.memberPositions,
          donors: normalizeDonorsArray(existing.donors),
          settlementResetAt: existing.settlementResetAt,
        }),
        existing,
        incoming
      );
    }
    return repairMemberTotalsForDonorRoster(
      syncMemberTotalsFromDonors({
        ...incoming,
        settlementResetAt: incomingReset,
        donors: incomingDonors,
      }),
      existing,
      incoming
    );
  }
  const shell = mergeDonationApplyBase(incoming, existing) ?? incoming;
  const useIncomingRoster = hasMeaningfulMemberRoster(incoming);
  const replaced = syncMemberTotalsFromDonors({
    ...shell,
    donors: incomingDonors,
    members: useIncomingRoster ? incoming.members : shell.members,
    memberPositions: useIncomingRoster
      ? incoming.memberPositions ?? shell.memberPositions
      : shell.memberPositions,
    settlementResetAt:
      Math.max(incomingReset, existingReset) || shell.settlementResetAt,
    updatedAt:
      Math.max(Number(incoming.updatedAt || 0), Number(existing.updatedAt || 0)) ||
      Date.now(),
    donorRankingsUpdatedAt:
      Math.max(
        Number(incoming.donorRankingsUpdatedAt || 0),
        Number(existing.donorRankingsUpdatedAt || 0)
      ) || incoming.donorRankingsUpdatedAt,
  });
  return repairMemberTotalsForDonorRoster(replaced, existing, incoming);
}
