import type {
  Donor,
  Member,
  SigMatchPool,
  SigMatchSettings,
  SettlementMemberRatioOverrides,
  SettlementMemberResult,
  SettlementRecord,
} from "@/types";
import { buildMemberCreationOrderIndex } from "@/lib/utils";
import { computePaymentChannelBreakdown } from "@/lib/settlement-payment-math";

function toSafeRate(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function floorToHundreds(value: number): number {
  return Math.floor(Math.max(0, value) / 100) * 100;
}

/**
 * 시그 후원 연동 상태.
 * donationLinks에 항목이 없으면 하위호환으로 ON(전체 기간).
 */
export function resolveSigMatchDonationLink(
  settings: Pick<SigMatchSettings, "donationLinks"> | null | undefined,
  memberId: string
): { active: boolean; startedAt: number } {
  const link = settings?.donationLinks?.[memberId];
  if (!link) return { active: true, startedAt: 0 };
  return {
    active: Boolean(link.active),
    startedAt: Number.isFinite(Number(link.startedAt)) ? Math.max(0, Math.floor(Number(link.startedAt))) : 0,
  };
}

export const DEFAULT_VAT_RATE = 0.1;

/** 부가세 포함 금액이면 공급가(÷(1+세율))로 환산 후 100원 단위 내림 */
export function toSettlementBaseAmount(
  raw: number,
  vatIncluded: boolean,
  vatRate = DEFAULT_VAT_RATE
): number {
  const floored = floorToHundreds(Math.max(0, raw));
  if (!vatIncluded) return floored;
  const rate = Math.max(0, vatRate || DEFAULT_VAT_RATE);
  return floorToHundreds(Math.round(floored / (1 + rate)));
}

/** 오버레이·후원 처리와 동일: 체크박스, 닉네임, 실명, 직급 텍스트 중 하나라도 운영비면 운영비 행 */
export function isOperatingSettlementMember(
  m: Pick<Member, "id" | "name" | "operating"> & { realName?: string },
  memberPositions?: Record<string, string> | null
): boolean {
  const pos = String(memberPositions?.[m.id] || "").trim();
  return (
    Boolean(m.operating) ||
    /운영비/i.test(String(m.name || "")) ||
    /운영비/i.test(String(m.realName || "")) ||
    /운영비/i.test(pos)
  );
}

/**
 * 정산 집계 — 지급정산서(정산서.xlsx)와 동일:
 * 후원금에서 수수료·부가세 공제 후 배분율 적용, 원천세 차감 = 최종정산
 */
export function computeSettlement(
  members: Member[],
  accountRatioRaw: number,
  toonRatioRaw: number,
  feeRateRaw = 0.033,
  memberRatioOverrides?: SettlementMemberRatioOverrides,
  memberPositions?: Record<string, string> | null,
  options?: { vatIncluded?: boolean; vatRate?: number }
): Omit<SettlementRecord, "id" | "title" | "createdAt"> {
  const accountRatio = toSafeRate(accountRatioRaw, 0.7);
  const toonRatio = toSafeRate(toonRatioRaw, 0.6);
  const feeRate = Math.max(0, feeRateRaw || 0);
  const vatIncluded = Boolean(options?.vatIncluded);
  const vatRate = Math.max(0, options?.vatRate ?? DEFAULT_VAT_RATE);

  const rows: SettlementMemberResult[] = (members || []).map((m) => {
    const accountSource = floorToHundreds(Math.max(0, m.account || 0));
    const toonSource = floorToHundreds(Math.max(0, m.toon || 0));
    // 지급정산서는 원금(부가세 포함 스냅샷) 기준. vatIncluded여도 원금으로 공제표를 맞춤.
    const accountGross = accountSource;
    const toonGross = toonSource;
    const account = vatIncluded
      ? toSettlementBaseAmount(m.account || 0, true, vatRate)
      : accountGross;
    const toon = vatIncluded ? toSettlementBaseAmount(m.toon || 0, true, vatRate) : toonGross;
    const isOperating = isOperatingSettlementMember(
      { id: m.id, name: m.name, operating: m.operating, realName: m.realName },
      memberPositions
    );
    const perMember = memberRatioOverrides?.[m.id];
    const effectiveAccountRatio = toSafeRate(
      isOperating
        ? 1
        : typeof perMember?.accountRatio === "number"
          ? perMember.accountRatio
          : accountRatio,
      accountRatio
    );
    const effectiveToonRatio = toSafeRate(
      isOperating
        ? 1
        : typeof perMember?.toonRatio === "number"
          ? perMember.toonRatio
          : toonRatio,
      toonRatio
    );
    const pay = computePaymentChannelBreakdown({
      accountGross,
      toonGross,
      accountRatio: effectiveAccountRatio,
      toonRatio: effectiveToonRatio,
      feeRate,
      skipWithholding: isOperating,
    });
    return {
      memberId: m.id,
      name: m.name,
      realName: m.realName || "",
      operating: isOperating,
      bankName: "",
      bankAccount: "",
      accountHolder: "",
      account,
      toon,
      ...(accountSource !== account ? { accountSource } : {}),
      ...(toonSource !== toon ? { toonSource } : {}),
      accountRatio: effectiveAccountRatio,
      toonRatio: effectiveToonRatio,
      accountApplied: pay.accountStreamerShare,
      toonApplied: pay.toonStreamerShare,
      gross: pay.pretaxTotal,
      fee: pay.withholding,
      net: pay.payout,
    };
  });

  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const totalFee = rows.reduce((s, r) => s + r.fee, 0);
  const totalNet = rows.reduce((s, r) => s + r.net, 0);

  return {
    accountRatio,
    toonRatio,
    feeRate,
    vatIncluded,
    ...(vatIncluded ? { vatRate } : {}),
    members: rows,
    totalGross,
    totalFee,
    totalNet,
  };
}

export type SigMatchRankingItem = {
  memberId: string;
  name: string;
  matchedCount: number;
  matchedAmount: number;
  manualAdjust: number;
  score: number;
};

/** 시그 집계 수치 표시(소수 건수·점수) */
export function formatSigMatchStat(n: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return rounded.toLocaleString("ko-KR");
  return rounded.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** 시그 대전 오버레이 — 개수/금액 모드에 맞는 표기 */
export function formatSigMatchScoreLabel(
  score: number,
  scoringMode: "count" | "amount"
): string {
  const n = formatSigMatchStat(score);
  return scoringMode === "amount" ? `${n}원` : `${n} 시그`;
}

/** VS 중앙 — 선두와의 점수·금액 차이 */
export function formatSigMatchGapLabel(
  gap: number,
  scoringMode: "count" | "amount"
): string {
  const n = formatSigMatchStat(Math.max(0, gap));
  return scoringMode === "amount" ? `${n}원` : `${n} 시그`;
}

function findPoolForMember(memberId: string, pools: SigMatchPool[]): string[] | null {
  for (const p of pools || []) {
    const ids = [...new Set((p.memberIds || []).filter(Boolean))];
    if (ids.length >= 1 && ids.includes(memberId)) return ids;
  }
  return null;
}

export function getSigMatchRankings(
  donors: Donor[],
  members: Member[],
  settings: SigMatchSettings,
  manualAdjustments?: Record<string, number>,
  memberPositions?: Record<string, string>
): SigMatchRankingItem[] {
  const allMembers = members || [];
  const positionMap = memberPositions || {};
  // 운영비는 시그 대결 참가/집계 대상에서 항상 제외
  const playableMembers = allMembers.filter(
    (m) =>
      !Boolean(m.operating) &&
      !/운영비/i.test(String(m.name || "")) &&
      !/운영비/i.test(String(m.realName || "")) &&
      !/운영비/i.test(String(positionMap[m.id] || ""))
  );
  const rawParticipants = settings.participantMemberIds || [];
  let rankingMembers = playableMembers;
  if (Array.isArray(rawParticipants) && rawParticipants.length > 0) {
    const allow = new Set(rawParticipants.filter((id) => playableMembers.some((m) => m.id === id)));
    if (allow.size > 0) {
      rankingMembers = playableMembers.filter((m) => allow.has(m.id));
    }
  }

  const keyword = (settings.keyword || "시그").trim().toLowerCase();
  const signatureSet = new Set(
    (settings.signatureAmounts || [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x > 0)
  );
  const pools = settings.sigMatchPools || [];
  const byMember = new Map<string, { count: number; amount: number }>();
  for (const m of rankingMembers) byMember.set(m.id, { count: 0, amount: 0 });

  for (const d of donors || []) {
    const memberId = d.memberId;
    if (!byMember.has(memberId)) continue;
    const link = resolveSigMatchDonationLink(settings, memberId);
    if (!link.active) continue;
    const donorAt = Number.isFinite(Number(d.at)) ? Math.max(0, Math.floor(Number(d.at))) : 0;
    if (link.startedAt > 0 && donorAt > 0 && donorAt < link.startedAt) continue;
    const amount = Math.max(0, Number(d.amount || 0));
    const countAll =
      settings.countAllDonations !== false &&
      (settings.scoringMode === "amount" || settings.countAllDonations === true);
    if (countAll) {
      const b = byMember.get(memberId)!;
      b.count += 1;
      b.amount += amount;
      continue;
    }
    const text = `${(d as unknown as Record<string, unknown>).message || ""} ${(d as unknown as Record<string, unknown>).memo || ""} ${d.name || ""}`.toLowerCase();
    const keywordMatched = keyword.length > 0 && text.includes(keyword);
    const signatureMatched = signatureSet.has(amount);
    if (!keywordMatched && !signatureMatched) continue;

    const pool = findPoolForMember(memberId, pools);
    let recipients: string[];
    if (pool) {
      recipients = pool.filter((id) => byMember.has(id));
      if (recipients.length < 2) recipients = [memberId];
    } else {
      recipients = [memberId];
    }

    const n = recipients.length;
    const incCount = 1 / n;
    const incAmount = amount / n;
    for (const id of recipients) {
      const recvLink = resolveSigMatchDonationLink(settings, id);
      if (!recvLink.active) continue;
      const b = byMember.get(id);
      if (!b) continue;
      b.count += incCount;
      b.amount += incAmount;
    }
  }

  const orderIndex = buildMemberCreationOrderIndex(rankingMembers);
  return rankingMembers
    .map((m) => {
      const stat = byMember.get(m.id) || { count: 0, amount: 0 };
      const manualAdjust = manualAdjustments?.[m.id] || 0;
      const baseScore = settings.scoringMode === "amount" ? stat.amount : stat.count;
      const score = Math.max(0, baseScore + manualAdjust);
      return {
        memberId: m.id,
        name: m.name,
        matchedCount: stat.count,
        matchedAmount: stat.amount,
        manualAdjust,
        score,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (orderIndex.get(a.memberId) ?? 0) - (orderIndex.get(b.memberId) ?? 0);
    });
}

