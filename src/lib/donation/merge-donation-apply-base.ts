import {
  DEFAULT_DONOR_RANKINGS_FULL_THEME,
  hasMeaningfulMemberRoster,
  isDefaultLikeDonorRankingsTheme,
  normalizeDonorsArray,
  pickOverlayPresetsPreferCustom,
} from "@/lib/state";
import type { AppState } from "@/types";
import { syncMemberTotalsFromDonors } from "./apply-donation-state";

/**
 * 후원 반영 — 서버 GET(빈 donors·placeholder)이 관리자 화면 stateRef 를 덮지 않게 병합.
 * id 기준 union, 동일 id는 hint(화면) 우선.
 * 멤버 금액은 병합된 donors 기준으로 재계산(힌트 멤버가 최신 후원을 덮어쓰지 않게).
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

  const useHintRoster = hasMeaningfulMemberRoster(hint);
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
