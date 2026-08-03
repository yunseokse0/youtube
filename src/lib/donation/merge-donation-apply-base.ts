import { hasMeaningfulMemberRoster, normalizeDonorsArray } from "@/lib/state";
import type { AppState } from "@/types";
import { dedupeDonorRows } from "./apply-donation-state";

/**
 * 후원 반영·단체짠 — 서버 GET(빈 donors·placeholder)이 관리자 화면 stateRef 를 덮지 않게 병합.
 * id 기준 union, 동일 id는 hint(화면) 우선.
 */
export function mergeDonationApplyBase(
  fresh: AppState | null | undefined,
  hint: AppState | null | undefined
): AppState | null {
  if (!hint && !fresh) return null;
  if (!fresh) return hint ?? null;
  if (!hint) return fresh;

  const freshDonors = dedupeDonorRows(normalizeDonorsArray(fresh.donors));
  const hintDonors = dedupeDonorRows(normalizeDonorsArray(hint.donors));
  const donorMap = new Map<string, (typeof freshDonors)[number]>();
  for (const d of freshDonors) donorMap.set(d.id, d);
  for (const d of hintDonors) donorMap.set(d.id, d);
  const mergedDonors = Array.from(donorMap.values()).sort((a, b) => b.at - a.at);

  const useHintMembers = hasMeaningfulMemberRoster(hint);
  const members = useHintMembers ? hint.members : fresh.members;

  return {
    ...fresh,
    ...hint,
    members,
    memberPositions: useHintMembers ? hint.memberPositions : fresh.memberPositions,
    memberPositionMode: hint.memberPositionMode ?? fresh.memberPositionMode,
    rankPositionLabels: hint.rankPositionLabels ?? fresh.rankPositionLabels,
    donors: mergedDonors,
    mealBattle: hint.mealBattle ?? fresh.mealBattle,
    donationSyncMode: hint.donationSyncMode ?? fresh.donationSyncMode,
    overlayPresets:
      (hint.overlayPresets?.length || 0) >= (fresh.overlayPresets?.length || 0)
        ? hint.overlayPresets
        : fresh.overlayPresets,
    updatedAt: Math.max(Number(hint.updatedAt || 0), Number(fresh.updatedAt || 0)) || Date.now(),
  };
}
