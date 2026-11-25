import type { AppState } from "@/types";
import { parseOverlayContributionNumber } from "@/lib/overlay-donation-aggregate";

/** Calculates the automatic contribution totals shown in the dedicated admin popup. */
export function collectPongdangPopupAutoContributionByMember(
  state: AppState | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  if (!state) return map;

  const cutoff = Math.max(0, Number(state.pongdangResetAt || 0));
  const includeZubzubBonus =
    state.zubzubSettings?.applyContributionToPongdang !== false;
  const applyDoubleToPongdang = state.zubzubSettings?.applyDoubleContributionToPongdang !== false;
  const zubzubLogKeys = new Set(
    (state.contributionLogs || [])
      .filter((log) => log.isZubzubBonus)
      .map((log) => log.zubzubQueueId || log.id)
  );
  const donors = (state.donors || []).filter(
    (donor) => !donor.donationExcluded || (includeZubzubBonus && donor.isZubzubBonus)
  );

  for (const donor of donors) {
    if (
      donor.isZubzubBonus &&
      zubzubLogKeys.has(donor.zubzubQueueId || donor.id)
    ) {
      continue;
    }
    if (cutoff > 0 && Number(donor.at || 0) < cutoff) continue;
    if (donor.memberAutoAssigned === true) continue;

    const memberId = String(donor.memberId || "").trim();
    if (!memberId) continue;

    const rawSigPrice = parseOverlayContributionNumber(donor.sigPrice);
    const sigPrice = rawSigPrice || (
      donor.isZubzubBonus
        ? parseOverlayContributionNumber(
            !applyDoubleToPongdang && donor.sigPrice
              ? donor.sigPrice
              : (donor.contributionPoints || donor.amount)
          )
        : 0
    );
    const contributionPoints = parseOverlayContributionNumber(donor.contributionPoints);
    const amount = parseOverlayContributionNumber(donor.amount);
    const isCredit = Boolean(donor.isSigCredit || donor.isZubzubBonus);
    let value = 0;
    if (sigPrice !== 0) value = Math.floor(Math.abs(sigPrice));
    else if (isCredit && contributionPoints !== 0) {
      value = Math.floor(Math.abs(contributionPoints));
    } else if (
      contributionPoints !== 0 &&
      Math.abs(amount) !== 777000 &&
      Math.abs(contributionPoints) !== Math.abs(amount)
    ) {
      value = Math.floor(Math.abs(contributionPoints));
    }

    if (value > 0) {
      const isMinus =
        Boolean(donor.pongdangMinus) ||
        rawSigPrice < 0 ||
        contributionPoints < 0;
      map.set(memberId, (map.get(memberId) || 0) + (isMinus ? -value : value));
    }
  }

  if (includeZubzubBonus) {
    for (const log of state.contributionLogs || []) {
      if (!log.isZubzubBonus) continue;
      const memberId = String(log.memberId || "").trim();
      if (!memberId) continue;
      if (cutoff > 0 && Number(log.at || 0) < cutoff) continue;

      const effectiveAmount =
        !applyDoubleToPongdang && (log.baseSigPrice || log.multiplier === 2)
          ? (log.baseSigPrice ?? Math.round(log.amount / 2))
          : log.amount;
      const rawAmount = parseOverlayContributionNumber(effectiveAmount);
      if (rawAmount === 0) continue;
      const amount = Math.floor(Math.abs(rawAmount));
      const isMinus = Boolean(log.pongdangMinus) || rawAmount < 0;
      map.set(memberId, (map.get(memberId) || 0) + (isMinus ? -amount : amount));
    }
  }

  return map;
}
