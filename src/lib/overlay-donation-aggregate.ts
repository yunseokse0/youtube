import type { AppState, ContributionLog, Donor, Member, RouletteState, SigItem } from "@/types";
import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import { readManualSigBroadcastFromState } from "@/lib/manual-sig-broadcast-state";

/** 프리셋/URL 값 → epoch ms. 비활성(전체 기간)이면 null */
export function normalizeDonationAggregateFromAt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function filterDonorsFromAggregateAt(
  donors: Donor[] | null | undefined,
  fromAt: number
): Donor[] {
  const t = Math.floor(Number(fromAt) || 0);
  if (t <= 0) return Array.isArray(donors) ? donors.slice() : [];
  return (donors || []).filter((d) => {
    const at = Number(d.at);
    return Number.isFinite(at) && at >= t;
  });
}

export function filterContributionLogsFromAggregateAt(
  logs: ContributionLog[] | null | undefined,
  fromAt: number
): ContributionLog[] {
  const t = Math.floor(Number(fromAt) || 0);
  if (t <= 0) return Array.isArray(logs) ? logs.slice() : [];
  return (logs || []).filter((l) => {
    const at = Number(l.at);
    return Number.isFinite(at) && at >= t;
  });
}

function isOneShotBundleSig(sig: { id?: string; name?: string } | null | undefined): boolean {
  const id = String(sig?.id || "").toLowerCase();
  const name = String(sig?.name || "").toLowerCase();
  return id.includes("one_shot") || id.includes("oneshot") || name.includes("한방");
}

function addAppearedSigPrice(
  prices: Set<number>,
  sig: { id?: string; name?: string; price?: number } | null | undefined
) {
  if (!sig || isOneShotBundleSig(sig)) return;
  const p = Math.max(0, Math.floor(Number(sig.price) || 0));
  if (p > 0) prices.add(p);
}

/**
 * 집계 창(fromAt) 이후 「나온 시그」 단가 집합.
 * - 회전판 historyLogs(LANDED/CONFIRMED) + 현재 selectedSigs/results
 * - 수동 방송 selectedSigs
 * 한방(합계) 카드는 제외 — 개별 시그 단가만.
 */
export function collectAppearedSigPrices(opts: {
  rouletteState?: RouletteState | null;
  manualSelectedSigs?: Array<Pick<SigItem, "id" | "name" | "price">> | null;
  fromAt?: number | null;
}): Set<number> {
  const fromAt = normalizeDonationAggregateFromAt(opts.fromAt) ?? 0;
  const prices = new Set<number>();
  const rs = opts.rouletteState;

  if (rs) {
    for (const log of rs.historyLogs || []) {
      const phase = String(log.phase || "").toUpperCase();
      if (phase === "CANCELLED") continue;
      if (fromAt > 0 && Number(log.timestamp || 0) < fromAt) continue;
      for (const s of log.selectedSigs || []) addAppearedSigPrice(prices, s);
    }
    const phase = String(rs.phase || "").toUpperCase();
    const includeCurrent =
      phase === "LANDED" ||
      phase === "CONFIRMED" ||
      phase === "CONFIRM_PENDING" ||
      phase === "SPINNING" ||
      (Array.isArray(rs.selectedSigs) && rs.selectedSigs.length > 0);
    if (includeCurrent) {
      for (const s of rs.selectedSigs || []) addAppearedSigPrice(prices, s);
      for (const s of rs.results || []) addAppearedSigPrice(prices, s);
      if (rs.result) addAppearedSigPrice(prices, rs.result);
    }
  }

  for (const s of opts.manualSelectedSigs || []) addAppearedSigPrice(prices, s);
  return prices;
}

export function collectAppearedSigPricesFromAppState(
  state: AppState | null | undefined,
  fromAt?: number | null
): Set<number> {
  const manual = readManualSigBroadcastFromState(state);
  const manualSigs =
    manual && (manual.phase === "LANDED" || manual.phase === "CONFIRMED")
      ? manual.selectedSigs
      : manual?.selectedSigs?.length
        ? manual.selectedSigs
        : [];
  return collectAppearedSigPrices({
    rouletteState: state?.rouletteState,
    manualSelectedSigs: manualSigs,
    fromAt,
  });
}

/** 나온 시그 단가와 금액이 일치하는 후원만 (777데이 기여도용) */
export function filterDonorsForDay777Calc(
  donors: Donor[] | null | undefined,
  appearedPrices: Set<number>,
  fromAt?: number | null
): Donor[] {
  const t = normalizeDonationAggregateFromAt(fromAt);
  let rows = Array.isArray(donors) ? donors.slice() : [];
  if (t != null) rows = filterDonorsFromAggregateAt(rows, t);
  if (appearedPrices.size === 0) return [];
  return rows.filter((d) => appearedPrices.has(Math.max(0, Math.floor(Number(d.amount) || 0))));
}

export type OverlayDonationDisplayOpts = {
  fromAt?: number | null;
  /** 나온 시그 단가와 같은 후원만 기여도에 반영 */
  day777Calc?: boolean;
};

/**
 * 오버레이 표시용 재합산.
 * - fromAt: 계좌/투네/기여도 시간 창
 * - day777Calc: 기여도만 나온 시그 단가 매칭 (계좌/투네는 fromAt 규칙 유지)
 * 원장 저장·정산 리셋과 무관.
 */
export function applyOverlayDonationDisplayTotals(
  state: AppState,
  opts: OverlayDonationDisplayOpts = {}
): AppState {
  const fromAt = normalizeDonationAggregateFromAt(opts.fromAt);
  const day777 = Boolean(opts.day777Calc);

  if (fromAt == null && !day777) return state;

  const donorsForAmount =
    fromAt != null ? filterDonorsFromAggregateAt(state.donors, fromAt) : state.donors || [];
  const logsForAmount =
    fromAt != null
      ? filterContributionLogsFromAggregateAt(state.contributionLogs, fromAt)
      : state.contributionLogs || [];

  const amountSynced = syncMemberTotalsFromDonors({
    ...state,
    donors: donorsForAmount,
    contributionLogs: day777 ? [] : logsForAmount,
  });

  if (!day777) return amountSynced;

  const prices = collectAppearedSigPricesFromAppState(state, fromAt);
  const day777Donors = filterDonorsForDay777Calc(state.donors, prices, fromAt);
  const contribSynced = syncMemberTotalsFromDonors({
    ...state,
    donors: day777Donors,
    contributionLogs: [],
  });
  const contribById = new Map(
    (contribSynced.members || []).map((m) => [m.id, Math.max(0, Number(m.contribution) || 0)])
  );

  return {
    ...amountSynced,
    members: (amountSynced.members || []).map((m) => ({
      ...m,
      contribution: contribById.get(m.id) ?? 0,
    })),
  };
}

/** @deprecated use applyOverlayDonationDisplayTotals */
export function applyOverlayDonationAggregateFromAt(
  state: AppState,
  fromAt: number | null | undefined
): AppState {
  return applyOverlayDonationDisplayTotals(state, { fromAt });
}

export function membersWithOverlayDonationAggregate(
  state: AppState,
  members: Member[],
  fromAt: number | null | undefined,
  opts?: { day777Calc?: boolean }
): Member[] {
  const fromAtN = normalizeDonationAggregateFromAt(fromAt);
  const day777 = Boolean(opts?.day777Calc);
  if (fromAtN == null && !day777) return members;
  return (
    applyOverlayDonationDisplayTotals(
      { ...state, members },
      { fromAt: fromAtN, day777Calc: day777 }
    ).members || members
  );
}

/** 기여도 열/순위용 donors·logs 슬라이스 (표시 전용) */
export function resolveOverlayContributionSource(
  state: Pick<AppState, "donors" | "contributionLogs" | "rouletteState" | "overlaySettings">,
  opts: OverlayDonationDisplayOpts = {}
): Pick<AppState, "donors" | "contributionLogs"> {
  const fromAt = normalizeDonationAggregateFromAt(opts.fromAt);
  const day777 = Boolean(opts.day777Calc);
  if (!day777 && fromAt == null) {
    return { donors: state.donors, contributionLogs: state.contributionLogs };
  }
  if (day777) {
    const prices = collectAppearedSigPricesFromAppState(state as AppState, fromAt);
    return {
      donors: filterDonorsForDay777Calc(state.donors, prices, fromAt),
      contributionLogs: [],
    };
  }
  return {
    donors: filterDonorsFromAggregateAt(state.donors, fromAt!),
    contributionLogs: filterContributionLogsFromAggregateAt(state.contributionLogs, fromAt!),
  };
}
