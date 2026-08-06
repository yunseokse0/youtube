import {
  DEFAULT_DONOR_RANKINGS_FULL_THEME,
  hasMeaningfulMemberRoster,
  isDefaultLikeDonorRankingsTheme,
  normalizeDonorsArray,
  pickOverlayPresetsPreferCustom,
} from "@/lib/state";
import type { AppState, Donor, Member } from "@/types";
import { syncMemberTotalsFromDonors } from "./apply-donation-state";

/** 후원 memberId 가 로스터에 얼마나 매칭되는지(금액 합) — 로스터 선택용 */
export function rosterDonorMatchScore(
  members: Member[] | null | undefined,
  donors: Donor[] | null | undefined
): number {
  const ids = new Set((members || []).map((m) => String(m.id || "").trim()).filter(Boolean));
  if (ids.size === 0) return 0;
  let score = 0;
  for (const d of donors || []) {
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
  for (const d of hintDonors) donorMap.set(d.id, d);
  const mergedDonors = Array.from(donorMap.values()).sort((a, b) => b.at - a.at);

  const hintStrong = hasMeaningfulMemberRoster(hint);
  const freshStrong = hasMeaningfulMemberRoster(fresh);
  const hintScore = rosterDonorMatchScore(hint.members, mergedDonors);
  const freshScore = rosterDonorMatchScore(fresh.members, mergedDonors);
  let useHintRoster = false;
  if (hintStrong && !freshStrong) useHintRoster = true;
  else if (!hintStrong && freshStrong) useHintRoster = false;
  else if (hintStrong && freshStrong) {
    /** 매칭 점수가 같으면 hint(화면) 우선 — 관리자 실멤버 유지 */
    useHintRoster = hintScore >= freshScore;
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
  return syncMemberTotalsFromDonors(merged);
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
