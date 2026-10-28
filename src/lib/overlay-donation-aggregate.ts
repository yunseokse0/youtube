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

/** 777데이에 흔히 쏘는 금액 — 계좌/투네에는 남기고 기여도로는 쓰지 않는다 */
export const DAY777_SHOT_AMOUNT = 777_000;

function appearedSigUnitPrice(
  sig: { id?: string; name?: string; price?: number } | null | undefined
): number {
  if (!sig || isOneShotBundleSig(sig)) return 0;
  return Math.max(0, Math.floor(Number(sig.price) || 0));
}

type AppearedSigCredit = { price: number; memberId: string };

function pushAppearedSigCredit(
  out: AppearedSigCredit[],
  sig: { id?: string; name?: string; price?: number; memberId?: string } | null | undefined,
  buyerMemberId?: string | null
) {
  const price = appearedSigUnitPrice(sig);
  if (price <= 0) return;
  out.push({
    price,
    memberId: String(sig?.memberId || buyerMemberId || "").trim(),
  });
}

function readManualBuyerMemberIds(state: AppState | null | undefined): (string | null)[] {
  const os = state?.overlaySettings;
  if (!os || typeof os !== "object") return [];
  const draft = (os as Record<string, unknown>).sigSalesManualDraftV1;
  if (!draft || typeof draft !== "object") return [];
  const raw = (draft as { sigBuyerMemberIds?: unknown }).sigBuyerMemberIds;
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => {
    const s = String(id || "").trim();
    return s ? s : null;
  });
}

function collectAppearedSigCredits(opts: {
  rouletteState?: RouletteState | null;
  manualSelectedSigs?: Array<Pick<SigItem, "id" | "name" | "price" | "memberId">> | null;
  manualBuyerMemberIds?: (string | null)[];
  fromAt?: number | null;
}): AppearedSigCredit[] {
  const fromAt = normalizeDonationAggregateFromAt(opts.fromAt) ?? 0;
  const out: AppearedSigCredit[] = [];
  const rs = opts.rouletteState;
  const buyers = opts.manualBuyerMemberIds || [];

  if (rs) {
    for (const log of rs.historyLogs || []) {
      const phase = String(log.phase || "").toUpperCase();
      if (phase === "CANCELLED") continue;
      if (fromAt > 0 && Number(log.timestamp || 0) < fromAt) continue;
      for (const s of log.selectedSigs || []) pushAppearedSigCredit(out, s);
    }
    const phase = String(rs.phase || "").toUpperCase();
    const includeCurrent =
      phase === "LANDED" ||
      phase === "CONFIRMED" ||
      phase === "CONFIRM_PENDING" ||
      phase === "SPINNING" ||
      (Array.isArray(rs.selectedSigs) && rs.selectedSigs.length > 0);
    if (includeCurrent) {
      for (const s of rs.selectedSigs || []) pushAppearedSigCredit(out, s);
      for (const s of rs.results || []) pushAppearedSigCredit(out, s);
      if (rs.result) pushAppearedSigCredit(out, rs.result);
    }
  }

  (opts.manualSelectedSigs || []).forEach((s, i) => {
    pushAppearedSigCredit(out, s, buyers[i] ?? null);
  });
  return out;
}

/** 777,000원 후원을 받은 멤버(가장 최근 건). 없으면 집계 창에 후원이 있는 유일한 멤버 */
export function resolveDay777SigCreditFallbackMemberId(
  donors: Donor[] | null | undefined,
  fromAt?: number | null
): string {
  const t = normalizeDonationAggregateFromAt(fromAt);
  const rows = t != null ? filterDonorsFromAggregateAt(donors, t) : Array.isArray(donors) ? donors : [];
  let latestShot: Donor | null = null;
  const memberIds = new Set<string>();
  for (const d of rows) {
    const mid = String(d.memberId || "").trim();
    if (mid) memberIds.add(mid);
    if (Math.max(0, Math.floor(Number(d.amount) || 0)) !== DAY777_SHOT_AMOUNT) continue;
    if (!latestShot || Number(d.at || 0) >= Number(latestShot.at || 0)) latestShot = d;
  }
  const shotMember = String(latestShot?.memberId || "").trim();
  if (shotMember) return shotMember;
  if (memberIds.size === 1) return [...memberIds][0] || "";
  return "";
}

/** 나온 시그 단가 → 멤버별 시그 기여도 (777,000원 후원 금액은 넣지 않음) */
export function collectDay777SigContributionByMember(
  state: AppState | null | undefined,
  fromAt?: number | null
): Map<string, number> {
  const manual = readManualSigBroadcastFromState(state);
  const manualSigs =
    manual && (manual.phase === "LANDED" || manual.phase === "CONFIRMED")
      ? manual.selectedSigs
      : manual?.selectedSigs?.length
        ? manual.selectedSigs
        : [];
  const credits = collectAppearedSigCredits({
    rouletteState: state?.rouletteState,
    manualSelectedSigs: manualSigs,
    manualBuyerMemberIds: readManualBuyerMemberIds(state),
    fromAt,
  });
  const fallback = resolveDay777SigCreditFallbackMemberId(state?.donors, fromAt);
  const byMember = new Map<string, number>();
  for (const row of credits) {
    const memberId = row.memberId || fallback;
    if (!memberId) continue;
    byMember.set(memberId, (byMember.get(memberId) || 0) + row.price);
  }
  return byMember;
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
  /** 퐁당퐁당 기여도 열만 나온 시그 단가(시그 기여도). 777,000원 후원 금액은 제외 */
  day777Calc?: boolean;
};

/**
 * 오버레이 표시용 재합산.
 * - fromAt: 계좌/투네 시간 창
 * - day777Calc: 퐁당퐁당 기여도만 나온 시그 단가로 적립. 계좌/투네는 777,000원이어도 그대로.
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

  const sigById = collectDay777SigContributionByMember(state, fromAt);

  return {
    ...amountSynced,
    members: (amountSynced.members || []).map((m) => ({
      ...m,
      contribution: sigById.get(m.id) ?? 0,
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
    /** 기여도는 멤버.contribution(나온 시그 단가)만 사용. 777,000원 후원 원장을 다시 합치지 않음 */
    return { donors: [], contributionLogs: [] };
  }
  return {
    donors: filterDonorsFromAggregateAt(state.donors, fromAt!),
    contributionLogs: filterContributionLogsFromAggregateAt(state.contributionLogs, fromAt!),
  };
}
