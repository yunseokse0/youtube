import type { AppState } from "@/types";
import { parseOverlayContributionNumber } from "@/lib/overlay-donation-aggregate";

/** Calculates the automatic contribution totals shown in the dedicated admin popup. */
export function collectPongdangPopupAutoContributionByMember(
  state: AppState | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  if (!state) return map;

  const rawReset = Number(state.pongdangResetAt || 0);
  if (rawReset === -1) {
    return map;
  }

  // pongdangResetAt이 명시 설정되지 않았을 때 퐁당 프리셋의 donationAggregateFromAt을 fallback으로 활용
  let cutoff = Math.max(0, rawReset);
  if (cutoff === 0 && Array.isArray(state.overlayPresets)) {
    for (const p of state.overlayPresets) {
      const isPd =
        p.membersTheme === "excelPongdang" ||
        p.theme === "excelPongdang" ||
        Boolean(p.day777Calc) ||
        String(p.name || "").includes("퐁당");
      if (isPd && p.donationAggregateFromAt) {
        const fromAtN = Number(p.donationAggregateFromAt);
        if (Number.isFinite(fromAtN) && fromAtN > 0) {
          cutoff = fromAtN;
          break;
        }
      }
    }
  }

  // 멤버 id 정규화 맵 (id -> id, name -> id)
  const memberIdNormalizeMap = new Map<string, string>();
  for (const m of state.members || []) {
    if (m.id) memberIdNormalizeMap.set(String(m.id).trim(), String(m.id).trim());
    if (m.name) memberIdNormalizeMap.set(String(m.name).trim(), String(m.id).trim());
  }

  const includeZubzubBonus =
    state.zubzubSettings?.applyContributionToPongdang !== false;
  const applyDoubleToPongdang = state.zubzubSettings?.applyDoubleContributionToPongdang !== false;
  const rawLogs =
    state.contributionLogs ||
    (state as { zubzubContributionLogs?: typeof state.contributionLogs }).zubzubContributionLogs ||
    [];
  const zubzubLogKeys = new Set(
    rawLogs
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

    const rawMid = String(donor.memberId || "").trim();
    if (!rawMid) continue;
    const memberId = memberIdNormalizeMap.get(rawMid) || rawMid;

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
    const hasSigInMessage = typeof donor.message === "string" && (donor.message.includes("시그") || donor.message.includes("777"));
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
    } else if (contributionPoints !== 0 && hasSigInMessage) {
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
    for (const log of rawLogs) {
      if (!log.isZubzubBonus) continue;
      const rawMid = String(log.memberId || "").trim();
      if (!rawMid) continue;
      const memberId = memberIdNormalizeMap.get(rawMid) || rawMid;
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
