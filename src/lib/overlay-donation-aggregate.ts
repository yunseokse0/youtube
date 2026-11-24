import type { AppState, ContributionLog, Donor, Member, RouletteState, SigItem } from "@/types";
import { syncMemberTotalsFromDonors, isPongdangMinusContributionLog } from "@/lib/donation/apply-donation-state";
import { readManualSigBroadcastFromState } from "@/lib/manual-sig-broadcast-state";

/** 프리셋/URL 값 → epoch ms. 비활성(전체 기간)이면 null, 책정 OFF면 -1 */
export function normalizeDonationAggregateFromAt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "off" || s === "-1" || s === "false" || s === "none") return -1;
  const n = typeof raw === "number" ? raw : Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function filterDonorsFromAggregateAt(
  donors: Donor[] | null | undefined,
  fromAt: number
): Donor[] {
  if (fromAt === -1) return [];
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
  if (fromAt === -1) return [];
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
    const curTs = Number((rs as any).timestamp ?? rs.startedAt ?? 0);
    const includeCurrent =
      (fromAt <= 0 || curTs <= 0 || curTs >= fromAt) &&
      (phase === "LANDED" ||
        phase === "CONFIRMED" ||
        phase === "CONFIRM_PENDING" ||
        phase === "SPINNING" ||
        (Array.isArray(rs.selectedSigs) && rs.selectedSigs.length > 0));
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

type AppearedSigCredit = { price: number; memberId: string; isManual?: boolean };

function pushAppearedSigCredit(
  out: AppearedSigCredit[],
  sig: { id?: string; name?: string; price?: number; memberId?: string } | null | undefined,
  buyerMemberId?: string | null,
  isManual?: boolean
) {
  const price = appearedSigUnitPrice(sig);
  if (price <= 0) return;
  out.push({
    price,
    memberId: String(sig?.memberId || buyerMemberId || "").trim(),
    isManual: Boolean(isManual),
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
  if (fromAt === -1) return [];
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
    const curTs = Number((rs as any).timestamp ?? rs.startedAt ?? 0);
    const includeCurrent =
      (fromAt <= 0 || curTs <= 0 || curTs >= fromAt) &&
      (phase === "LANDED" ||
        phase === "CONFIRMED" ||
        phase === "CONFIRM_PENDING" ||
        phase === "SPINNING" ||
        (Array.isArray(rs.selectedSigs) && rs.selectedSigs.length > 0));
    if (includeCurrent) {
      for (const s of rs.selectedSigs || []) pushAppearedSigCredit(out, s);
      for (const s of rs.results || []) pushAppearedSigCredit(out, s);
      if (rs.result) pushAppearedSigCredit(out, rs.result);
    }
  }

  (opts.manualSelectedSigs || []).forEach((s, i) => {
    pushAppearedSigCredit(out, s, buyers[i] ?? null, true);
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
    if (d.donationExcluded === true) continue;
    // 불명확하여 자동 임시배정된 후원은 배정 후보에서 제외
    if (d.memberAutoAssigned === true) continue;
    const mid = String(d.memberId || "").trim();
    if (mid) memberIds.add(mid);
    if (Math.max(0, Math.floor(Number(d.amount) || 0)) !== DAY777_SHOT_AMOUNT) continue;
    if (!latestShot || Number(d.at || 0) >= Number(latestShot.at || 0)) latestShot = d;
  }
  const shotMember = String(latestShot?.memberId || "").trim();
  if (shotMember) return shotMember;
  if (memberIds.size === 1) return [...memberIds][0];
  return "";
}

export type Day777SigContributionOpts = {
  /** true면 d.pongdangMinus를 무시하고 정상(+) 단가로 합산 (메인 엑셀표/오버레이용) */
  ignorePongdangMinus?: boolean;
};

/** 나온 시그 단가 → 멤버별 시그 기여도 (777,000원 후원 금액은 넣지 않음) */
export function collectDay777SigContributionByMember(
  state: AppState | null | undefined,
  fromAt?: number | null,
  opts?: Day777SigContributionOpts
): Map<string, number> {
  const explicitFromAt = normalizeDonationAggregateFromAt(fromAt);
  const isPongdangOff = Number(state?.pongdangResetAt || 0) === -1;
  if (explicitFromAt === -1 || isPongdangOff) {
    return new Map();
  }

  const resetCutoff = Math.max(
    0,
    Number(state?.settlementResetAt || 0),
    Number((state as { intentionalDonationClearAt?: number })?.intentionalDonationClearAt || 0),
    Number(state?.pongdangResetAt || 0)
  );
  // 사용자가 프리셋/오버레이에서 명시적으로 특정 시각(또는 지금부터)을 지정한 경우 해당 시점 이후로 집계.
  // 미지정 시 리셋 시각(pongdangResetAt / settlementResetAt) 기준으로 누적 수집.
  const effectiveFromAtOrNull = explicitFromAt != null
    ? Math.max(explicitFromAt, resetCutoff)
    : (resetCutoff > 0 ? resetCutoff : null);

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
    fromAt: effectiveFromAtOrNull,
  });
  const fallback = resolveDay777SigCreditFallbackMemberId(state?.donors, effectiveFromAtOrNull);
  const byMember = new Map<string, number>();
  for (const row of credits) {
    // 수동 시그 판매 건은 구매 멤버가 선택되지 않았을 경우 미판매 건이므로 fallback으로 임의 배정하지 않음
    const memberId = row.memberId || (row.isManual ? "" : fallback);
    if (!memberId) continue;
    byMember.set(memberId, (byMember.get(memberId) || 0) + row.price);
  }

  // 외부(Toona 등 타 프로젝트)에서 전달된 나온 시그 기여도 (sigPrice 또는 isSigCredit / contributionPoints)
  const donorRows = effectiveFromAtOrNull != null ? filterDonorsFromAggregateAt(state?.donors, effectiveFromAtOrNull) : state?.donors || [];
  const ignoreMinus = Boolean(opts?.ignorePongdangMinus);
  for (const d of donorRows) {
    if (d.donationExcluded === true && !d.isZubzubBonus) continue;
    // 멤버명이 불명확하여 자동 임의 배정(1위 등)된 후원은 백오피스에서 사용자가 지정하기 전까지 퐁당퐁당 기여도에 미반영
    if (d.memberAutoAssigned === true) continue;
    const mid = String(d.memberId || fallback || "").trim();
    if (!mid) continue;
    const explicitSigPrice = Math.max(
      0,
      Math.floor(Number((d as { sigPrice?: number }).sigPrice || (d.isZubzubBonus ? (d.amount || d.contributionPoints) : 0) || 0))
    );
    const cp = Math.max(0, Math.floor(Number(d.contributionPoints || 0)));
    const amt = Math.max(0, Math.floor(Number(d.amount || 0)));
    const isCredit = Boolean((d as { isSigCredit?: boolean }).isSigCredit || d.isZubzubBonus);

    const mult = (!ignoreMinus && d.pongdangMinus) ? -1 : 1;
    if (explicitSigPrice > 0) {
      byMember.set(mid, (byMember.get(mid) || 0) + mult * explicitSigPrice);
    } else if (isCredit && cp > 0) {
      byMember.set(mid, (byMember.get(mid) || 0) + mult * cp);
    } else if (cp > 0 && amt !== DAY777_SHOT_AMOUNT && cp !== amt) {
      // 랜덤 후원 금액(amt)과 전달된 기여도(cp)가 다르면 나온 시그 단가로 간주
      byMember.set(mid, (byMember.get(mid) || 0) + mult * cp);
    }
  }
  // 기여도 기록부(contributionLogs) 수동 가감 로그 합산
  const logs = effectiveFromAtOrNull != null ? filterContributionLogsFromAggregateAt(state?.contributionLogs, effectiveFromAtOrNull) : state?.contributionLogs || [];
  for (const log of logs) {
    const mid = String(log.memberId || "").trim();
    if (!mid) continue;
    if (ignoreMinus && isPongdangMinusContributionLog(log)) {
      continue;
    }
    const delta = log.delta === -1 ? -1 : 1;
    const amt = Math.max(0, Math.floor(Number(log.amount || 0)));
    byMember.set(mid, (byMember.get(mid) || 0) + delta * amt);
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
  /** 퐁당퐁당 기여도 수동 입력 모드 (수동 입력값 적용) */
  pongdangManualMode?: boolean;
  /** 퐁당퐁당 전용 팝업창 모드 (마이너스 기여도 및 음수 표시 허용). 오버레이 엑셀표는 기본 false */
  isPongdangPopup?: boolean;
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
  const fromAt = normalizeDonationAggregateFromAt(opts?.fromAt);
  const day777 = Boolean(opts?.day777Calc);
  const isPongdangPopup = Boolean(opts?.isPongdangPopup);

  // 책정 OFF (-1): 전체 후원 및 기여도 0원 고정 표출
  if (fromAt === -1) {
    return {
      ...state,
      members: (state.members || []).map((m) => ({
        ...m,
        account: 0,
        toon: 0,
        contribution: 0,
      })),
    };
  }

  if (fromAt == null && !day777) {
    return {
      ...state,
      members: (state.members || []).map((m) => ({
        ...m,
        contribution: isPongdangPopup
          ? Math.floor(Number(m.contribution) || 0)
          : Math.max(0, Math.floor(Number(m.contribution) || 0)),
      })),
    };
  }

  const donorsForAmount =
    fromAt != null ? filterDonorsFromAggregateAt(state.donors, fromAt) : state.donors || [];
  const logsForAmount =
    fromAt != null
      ? filterContributionLogsFromAggregateAt(state.contributionLogs, fromAt)
      : state.contributionLogs || [];

  // 엑셀표(오버레이)에서는 퐁당퐁당 마이너스 로그 제외
  const filteredLogsForAmount = (logsForAmount || []).filter((l) => {
    if (isPongdangPopup) return true;
    return !isPongdangMinusContributionLog(l);
  });

  const amountSynced = syncMemberTotalsFromDonors({
    ...state,
    donors: donorsForAmount,
    contributionLogs: day777 ? [] : filteredLogsForAmount,
  });

  if (!day777) return amountSynced;

  const originalMemberMap = new Map((state.members || []).map((m) => [m.id, m]));
  // 수동 기여도 보정값은 항시 반영 (명시적으로 false로 끈 경우가 아니면 기본 true로 자동 수집값과 실시간 합산)
  const isManualMode =
    opts?.pongdangManualMode !== undefined
      ? Boolean(opts.pongdangManualMode)
      : state.pongdangManualMode !== false;
  const manualContribs = state.pongdangManualContributions || {};

  const pongdangResetCutoff = Math.max(
    0,
    Number(state?.pongdangResetAt || 0)
  );
  // 0원 초기화(pongdangResetAt)가 실행된 경우 초기화 시점을 최우선 반영하여 과거 후원 재합산 방지
  const effectiveCutoff = Math.max(fromAt || 0, pongdangResetCutoff || 0) || null;

  // 오버레이에서도 관리자가 마이너스 처리한 시그를 그대로 차감 반영
  const sigById = collectDay777SigContributionByMember(state, effectiveCutoff, {
    ignorePongdangMinus: false,
  });

  return {
    ...amountSynced,
    members: (amountSynced.members || []).map((m) => {
      const orig = originalMemberMap.get(m.id);
      const autoVal = sigById.get(m.id) ?? 0;
      let manualAdj = isManualMode ? Number(manualContribs[m.id]) || 0 : 0;
      const currentContrib = Math.floor(Number(orig?.contribution) || 0);
      const hasDonorsSource = Array.isArray(state?.donors) && state.donors.length > 0;
      const baseVal = autoVal !== 0 ? autoVal : (effectiveCutoff != null || hasDonorsSource ? 0 : currentContrib);
      const rawTotal = baseVal + manualAdj;
      return {
        ...m,
        contribution: isPongdangPopup ? rawTotal : Math.max(0, rawTotal),
      };
    }),
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
  opts?: { day777Calc?: boolean; pongdangManualMode?: boolean; isPongdangPopup?: boolean }
): Member[] {
  const fromAtN = normalizeDonationAggregateFromAt(fromAt);
  const day777 = Boolean(opts?.day777Calc);
  const isPongdangPopup = Boolean(opts?.isPongdangPopup);
  if (fromAtN == null && !day777) {
    return members.map((m) => ({
      ...m,
      contribution: isPongdangPopup
        ? Math.floor(Number(m.contribution) || 0)
        : Math.max(0, Math.floor(Number(m.contribution) || 0)),
    }));
  }
  return (
    applyOverlayDonationDisplayTotals(
      { ...state, members },
      {
        fromAt: fromAtN,
        day777Calc: day777,
        pongdangManualMode: opts?.pongdangManualMode,
        isPongdangPopup,
      }
    ).members || members
  );
}

/** 기여도 열/순위용 donors·logs 슬라이스 (표시 전용) */
export function resolveOverlayContributionSource(
  state: Pick<AppState, "donors" | "contributionLogs" | "rouletteState" | "overlaySettings">,
  opts: OverlayDonationDisplayOpts = {}
): Pick<AppState, "donors" | "contributionLogs"> {
  const fromAt = normalizeDonationAggregateFromAt(opts.fromAt);
  if (fromAt === -1) {
    return { donors: [], contributionLogs: [] };
  }
  const day777 = Boolean(opts.day777Calc);
  const isPongdangPopup = Boolean(opts.isPongdangPopup);
  const filterMinusLogs = (logs: ContributionLog[] | undefined) => {
    if (!logs) return [];
    return logs;
  };
  if (!day777 && fromAt == null) {
    return { donors: state.donors, contributionLogs: filterMinusLogs(state.contributionLogs) };
  }
  if (day777) {
    /** 기여도는 멤버.contribution(나온 시그 단가)만 사용. 777,000원 후원 원장을 다시 합치지 않음 */
    return { donors: [], contributionLogs: [] };
  }
  return {
    donors: filterDonorsFromAggregateAt(state.donors, fromAt!),
    contributionLogs: filterMinusLogs(filterContributionLogsFromAggregateAt(state.contributionLogs, fromAt!)),
  };
}
