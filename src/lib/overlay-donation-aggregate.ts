import type { AppState, ContributionLog, Donor, Member, RouletteState, SigItem } from "@/types";
import { syncMemberTotalsFromDonors, isPongdangMinusContributionLog, isPongdangContributionLog } from "@/lib/donation/apply-donation-state";
import { readManualSigBroadcastFromState } from "@/lib/manual-sig-broadcast-state";
import { collectPongdangPopupAutoContributionByMember } from "@/lib/pongdang-popup-contribution";

export function parseOverlayContributionNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "")
    .trim()
    .replace(/[,\s，]/g, "")
    .replace(/[−–—]/g, "-");
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isRestoredContributionLog(log: Pick<ContributionLog, "note">): boolean {
  const note = String(log?.note || "");
  return (
    note.includes("[정산 리셋 기여도 복원]") ||
    note.includes("[회차 기여도 불러오기:")
  );
}

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
  const pReset = state?.pongdangResetAt;
  const hasPReset = pReset !== undefined && pReset !== null;
  const pResetNum = Number(pReset);
  const isPongdangOff = explicitFromAt === -1 || pResetNum === -1;
  if (isPongdangOff) {
    return new Map();
  }

  // 퐁당퐁당(777데이) 기여도 계산 기준 시점:
  // 1) 사용자가 프리셋이나 파라미터로 명시적인 시각(과거 시각 포함)을 지정한 경우 그 시점을 존중 (과거 시각 복원 지원)
  // 2) fromAt이 없거나 0(전체 기간)인 경우: pongdangResetAt 반영 (0이면 전체 기간 null, >0이면 해당 시점 이후)
  // 3) pongdangResetAt 필드가 없는 레거시 상태 호환용: settlementResetAt 사용
  let effectiveFromAtOrNull: number | null = null;
  if (explicitFromAt != null && explicitFromAt > 0) {
    effectiveFromAtOrNull = explicitFromAt;
  } else if (hasPReset) {
    effectiveFromAtOrNull = pResetNum > 0 ? pResetNum : null;
  } else {
    const legacyCutoff = Math.max(
      0,
      Number(state?.settlementResetAt || 0),
      Number((state as { intentionalDonationClearAt?: number })?.intentionalDonationClearAt || 0)
    );
    effectiveFromAtOrNull = legacyCutoff > 0 ? legacyCutoff : null;
  }

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
  const donorRows = effectiveFromAtOrNull != null
    ? filterDonorsFromAggregateAt(state?.donors, effectiveFromAtOrNull)
    : state?.donors || [];
  const fallbackMemberId = resolveDay777SigCreditFallbackMemberId(
    donorRows,
    effectiveFromAtOrNull
  );
  const byMember = new Map<string, number>();
  for (const row of credits) {
    // 미지정 시그는 777,000원 수령자 또는 유일한 후원자에게만 귀속한다.
    const memberId = String(row.memberId || fallbackMemberId).trim();
    if (!memberId) continue;
    byMember.set(memberId, (byMember.get(memberId) || 0) + row.price);
  }

  // 외부(Toona 등 타 프로젝트)에서 전달된 나온 시그 기여도 (sigPrice 또는 isSigCredit / contributionPoints)
  const ignoreMinus = Boolean(opts?.ignorePongdangMinus);
  /** 줍줍 보너스(가상 Donor)를 퐁당퐁당 기여도에 합산할지 — 옵션(기본 true) */
  const includeZubzubBonus = state?.zubzubSettings?.applyContributionToPongdang !== false;
  /** 퐁당퐁당 기여도에도 줍줍 2배 보너스를 적용할지 — 옵션(기본 true, false면 1배만 적용) */
  const applyDoubleToPongdang = state?.zubzubSettings?.applyDoubleContributionToPongdang !== false;
  for (const d of donorRows) {
    if (d.donationExcluded === true && !(includeZubzubBonus && d.isZubzubBonus)) continue;
    // 멤버명이 불명확하여 자동 임의 배정(1위 등)된 후원은 백오피스에서 사용자가 지정하기 전까지 퐁당퐁당 기여도에 미반영
    if (d.memberAutoAssigned === true) continue;
    const mid = String(d.memberId || "").trim();
    if (!mid) continue;
    const sigPriceSource =
      (d as { sigPrice?: number }).sigPrice ??
      (d.isZubzubBonus
        ? (!applyDoubleToPongdang && d.sigPrice ? d.sigPrice : (d.contributionPoints ?? d.amount))
        : 0);
    const parsedSigPrice = parseOverlayContributionNumber(sigPriceSource);
    const parsedContributionPoints = parseOverlayContributionNumber(d.contributionPoints);
    const explicitSigPrice = Math.floor(Math.abs(parsedSigPrice));
    const cp = Math.floor(Math.abs(parsedContributionPoints));
    const amt = Math.floor(Math.abs(parseOverlayContributionNumber(d.amount)));
    const isCredit = Boolean((d as { isSigCredit?: boolean }).isSigCredit || d.isZubzubBonus);

    const isMinus = Boolean(d.pongdangMinus || parsedSigPrice < 0 || parsedContributionPoints < 0);
    const mult = !ignoreMinus && isMinus ? -1 : 1;
    if (explicitSigPrice > 0) {
      byMember.set(mid, (byMember.get(mid) || 0) + mult * explicitSigPrice);
    } else if (isCredit && cp > 0) {
      byMember.set(mid, (byMember.get(mid) || 0) + mult * cp);
    } else if (cp > 0 && amt !== DAY777_SHOT_AMOUNT && cp !== amt) {
      // 랜덤 후원 금액(amt)과 전달된 기여도(cp)가 다르면 나온 시그 단가로 간주
      byMember.set(mid, (byMember.get(mid) || 0) + mult * cp);
    } else if (isMinus && amt > 0) {
      // 일반 후원 건도 pongdangMinus가 true면 음수로 차감
      byMember.set(mid, (byMember.get(mid) || 0) - amt);
    }
  }
  // 기여도 기록부(contributionLogs) 수동 가감 로그 합산
  const contributionLogs = state?.contributionLogs || state?.zubzubContributionLogs || [];
  const logs = effectiveFromAtOrNull != null
    ? filterContributionLogsFromAggregateAt(contributionLogs, effectiveFromAtOrNull)
    : contributionLogs;
  for (const log of logs) {
    const mid = String(log.memberId || "").trim();
    if (!mid) continue;
    // ⭐️ 퐁당퐁당 기여도에는 줍줍 보너스 또는 퐁당퐁당 전용 로그(cl_pd_, plog_, isPongdang 등)만 합산!
    // 메인 엑셀표 일반 수동 기여도 로그는 퐁당퐁당에 절대 합산되지 않도록 분리
    if (!log.isZubzubBonus && !isPongdangContributionLog(log)) {
      continue;
    }
    if (
      log.isZubzubBonus &&
      state?.zubzubSettings?.applyContributionToPongdang === false
    ) {
      continue;
    }
    const logEffectiveAmount =
      log.isZubzubBonus && !applyDoubleToPongdang && (log.baseSigPrice || log.multiplier === 2)
        ? (log.baseSigPrice ?? Math.round(log.amount / 2))
        : log.amount;
    const parsedAmount = parseOverlayContributionNumber(logEffectiveAmount);
    if (ignoreMinus && (isPongdangMinusContributionLog(log) || parsedAmount < 0)) {
      continue;
    }
    const amt = Math.floor(Math.abs(parsedAmount));
    const delta = log.isZubzubBonus
      ? (!ignoreMinus && (log.pongdangMinus || parsedAmount < 0) ? -1 : 1)
      : log.delta === -1
        ? -1
        : parsedAmount < 0
          ? -1
          : 1;
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
  const isPongdangPopup = Boolean(opts?.isPongdangPopup);
  const day777 = Boolean(opts?.day777Calc);

  // 책정 OFF (-1): 전체 후원 및 기여도 0원 고정 표출
  if (fromAt === -1 || (Number(state?.pongdangResetAt || 0) === -1 && (day777 || isPongdangPopup))) {
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

  if (fromAt == null && !day777 && !isPongdangPopup) {
    return {
      ...state,
      members: (state.members || []).map((m) => ({
        ...m,
        contribution: Math.max(0, Math.floor(parseOverlayContributionNumber(m.contribution))),
      })),
    };
  }

  const donorsForAmount =
    fromAt != null ? filterDonorsFromAggregateAt(state.donors, fromAt) : state.donors || [];
  const rawLogs =
    state.contributionLogs ||
    (state as { zubzubContributionLogs?: ContributionLog[] }).zubzubContributionLogs ||
    [];
  const logsForAmount =
    fromAt != null
      ? filterContributionLogsFromAggregateAt(rawLogs, fromAt)
      : rawLogs;

  // 메인 엑셀표(오버레이)에서는 퐁당퐁당 기여도 로그를 완전히 제외 (별도 항목)
  const filteredLogsForAmount = (logsForAmount || []).filter((l) => {
    if (isPongdangPopup) return true;
    return !isPongdangContributionLog(l);
  });

  const amountSynced = syncMemberTotalsFromDonors({
    ...state,
    donors: donorsForAmount,
    contributionLogs: day777 ? [] : filteredLogsForAmount,
  });

  if (!day777 && !isPongdangPopup) return amountSynced;

  const originalMemberMap = new Map((state.members || []).map((m) => [m.id, m]));
  // 수동 기여도 보정값은 항시 반영 (명시적으로 false로 끈 경우가 아니면 기본 true로 자동 수집값과 실시간 합산)
  const isManualMode =
    opts?.pongdangManualMode !== undefined
      ? Boolean(opts.pongdangManualMode)
      : state.pongdangManualMode !== false;
  const manualContribs = state.pongdangManualContributions || {};

  const pReset = state?.pongdangResetAt;
  const hasPReset = pReset !== undefined && pReset !== null;
  const pResetNum = Number(pReset);

  let effectiveCutoff: number | null = null;
  if (fromAt === -1 || pResetNum === -1) {
    effectiveCutoff = -1;
  } else if (fromAt != null && fromAt > 0) {
    // 사용자가 프리셋/URL에서 명시적으로 특정 일시(과거 시각 포함)를 지정한 경우
    if (hasPReset && pResetNum > 0 && pResetNum < fromAt) {
      // pongdangResetAt이 더 과거 시각으로 명시 설정되었다면 더 넓은 과거 범위 존중
      effectiveCutoff = pResetNum;
    } else {
      effectiveCutoff = fromAt;
    }
  } else if (hasPReset) {
    // fromAt 미지정 시 pongdangResetAt 기준 (0이면 전체 기간 null, >0이면 해당 시각)
    effectiveCutoff = pResetNum > 0 ? pResetNum : null;
  } else {
    effectiveCutoff = null;
  }

  // 오버레이에서도 관리자가 마이너스 처리한 시그를 그대로 차감 반영
  const sigById = collectDay777SigContributionByMember(state, effectiveCutoff, {
    ignorePongdangMinus: false,
  });

  const popupAutoById = collectPongdangPopupAutoContributionByMember({
    ...state,
    pongdangResetAt: effectiveCutoff ?? 0,
  });

  // 수동 기여도 가감 로그(cl_pd_, plog_, 수동 등록 등, 줍줍 보너스는 제외)
  const manualLogMap = new Map<string, number>();
  const allLogs =
    state.contributionLogs ||
    (state as { zubzubContributionLogs?: ContributionLog[] }).zubzubContributionLogs ||
    [];
  for (const l of allLogs) {
    if (l.isZubzubBonus) continue;
    // ⭐️ 퐁당퐁당 수동 기여도 로그는 퐁당퐁당 전용 로그(cl_pd_, plog_, isPongdang 등)만 합산!
    // 메인 엑셀표 일반 수동 기여도는 퐁당퐁당에 절대 합산되지 않도록 분리
    if (!isPongdangContributionLog(l)) continue;
    const mid = String(l.memberId || "").trim();
    if (!mid) continue;
    if (effectiveCutoff != null && effectiveCutoff > 0 && Number(l.at || 0) < effectiveCutoff) continue;
    const rawAmount = parseOverlayContributionNumber(l.amount);
    if (rawAmount === 0) continue;
    const amount = Math.floor(Math.abs(rawAmount));
    const isMinus = l.delta === -1 || rawAmount < 0;
    manualLogMap.set(mid, (manualLogMap.get(mid) || 0) + (isMinus ? -amount : amount));
  }

  return {
    ...amountSynced,
    members: (amountSynced.members || []).map((m) => {
      const orig = originalMemberMap.get(m.id);
      const fromSig = sigById.has(m.id);
      const autoVal = fromSig
        ? (sigById.get(m.id) ?? 0)
        : (popupAutoById.get(m.id) ?? 0);
      const logVal = manualLogMap.get(m.id) ?? 0;
      const directManualVal = isManualMode ? parseOverlayContributionNumber(manualContribs[m.id]) : 0;
      // sigById는 이미 contributionLogs를 자체 합산하므로 중복 합산 방지
      const totalManual = fromSig ? directManualVal : logVal + directManualVal;
      const currentContrib = Math.floor(parseOverlayContributionNumber(orig?.contribution));
      let baseVal = 0;
      if (day777) {
        // 퐁당퐁당 엑셀표(오버레이): 순수 자동 시그 기여도에 퐁당퐁당 수동 보정값(manualLogMap + pongdangManualContributions)만 합산!
        // 메인 엑셀표 기여도(currentContrib)를 절대 상속받지 않음
        baseVal = isManualMode ? autoVal + totalManual : autoVal;
      } else {
        if (autoVal !== 0) {
          baseVal = autoVal;
        } else if (popupAutoById.has(m.id) && popupAutoById.get(m.id) !== 0) {
          baseVal = popupAutoById.get(m.id) || 0;
        } else if (currentContrib !== 0) {
          baseVal = currentContrib;
        } else {
          baseVal = Number(m.contribution) || 0;
        }
      }
      const pongdangAuto = autoVal !== 0
        ? autoVal
        : (popupAutoById.get(m.id) ?? (sigById.get(m.id) ?? 0));
      const pongdangRaw = isManualMode ? pongdangAuto + totalManual : pongdangAuto;
      const pongdangVal = pongdangRaw !== 0
        ? pongdangRaw
        : (currentContrib < 0 ? currentContrib : 0);
      const rawTotal = isPongdangPopup || day777 ? pongdangVal : baseVal;
      return {
        ...m,
        contribution: isPongdangPopup || day777 ? rawTotal : Math.max(0, rawTotal),
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
  const isPongdangPopup = Boolean(opts?.isPongdangPopup);
  const day777 = Boolean(opts?.day777Calc);
  if (fromAtN == null && !day777 && !isPongdangPopup) {
    return members.map((m) => ({
      ...m,
      contribution: Math.max(0, Math.floor(parseOverlayContributionNumber(m.contribution))),
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
  state: Pick<
    AppState,
    "donors" | "contributionLogs" | "zubzubContributionLogs" | "rouletteState" | "overlaySettings"
  >,
  opts: OverlayDonationDisplayOpts = {}
): Pick<AppState, "donors" | "contributionLogs"> {
  const fromAt = normalizeDonationAggregateFromAt(opts.fromAt);
  if (fromAt === -1) {
    return { donors: [], contributionLogs: [] };
  }
  const day777 = Boolean(opts.day777Calc);
  const isPongdangPopup = Boolean(opts.isPongdangPopup);
  const rawLogs = state.contributionLogs || state.zubzubContributionLogs || [];
  // 퐁당퐁당 팝업/표가 아닌 일반 메인 엑셀표는 퐁당퐁당 기여도 로그를 완전히 제외 (별도 항목)
  const contributionLogs = isPongdangPopup
    ? rawLogs
    : rawLogs.filter((l) => !isPongdangContributionLog(l));
  const filterMinusLogs = (logs: ContributionLog[] | undefined) => {
    if (!logs) return [];
    return logs;
  };
  if (!day777 && fromAt == null) {
    return { donors: state.donors, contributionLogs: filterMinusLogs(contributionLogs) };
  }
  if (day777) {
    /** 기여도는 멤버.contribution(나온 시그 단가)만 사용. 777,000원 후원 원장을 다시 합치지 않음 */
    return { donors: [], contributionLogs: filterMinusLogs(contributionLogs) };
  }
  return {
    donors: filterDonorsFromAggregateAt(state.donors, fromAt!),
    contributionLogs: filterMinusLogs(filterContributionLogsFromAggregateAt(contributionLogs, fromAt!)),
  };
}
