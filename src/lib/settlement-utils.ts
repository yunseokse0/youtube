import type {
  Donor,
  Member,
  SigMatchPool,
  SigMatchSettings,
  SettlementMemberRatioOverrides,
  SettlementMemberResult,
  SettlementRecord,
} from "@/types";

function toSafeRate(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function floorToHundreds(value: number): number {
  return Math.floor(Math.max(0, value) / 100) * 100;
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

export function computeSettlement(
  members: Member[],
  accountRatioRaw: number,
  toonRatioRaw: number,
  feeRateRaw = 0.033,
  memberRatioOverrides?: SettlementMemberRatioOverrides,
  memberPositions?: Record<string, string> | null
): Omit<SettlementRecord, "id" | "title" | "createdAt"> {
  const accountRatio = toSafeRate(accountRatioRaw, 0.7);
  const toonRatio = toSafeRate(toonRatioRaw, 0.6);
  const feeRate = Math.max(0, feeRateRaw || 0);

  const rows: SettlementMemberResult[] = (members || []).map((m) => {
    // 정산(엑셀/CVS/TXT 포함)은 원금 기준을 100원 단위 버림으로 통일.
    const account = floorToHundreds(Math.max(0, m.account || 0));
    const toon = floorToHundreds(Math.max(0, m.toon || 0));
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
    const accountApplied = Math.round(account * effectiveAccountRatio);
    const toonApplied = Math.round(toon * effectiveToonRatio);
    const gross = accountApplied + toonApplied;
    const fee = isOperating ? 0 : Math.round(gross * feeRate);
    const net = Math.max(0, gross - fee);
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
      accountRatio: effectiveAccountRatio,
      toonRatio: effectiveToonRatio,
      accountApplied,
      toonApplied,
      gross,
      fee,
      net,
    };
  });

  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const totalFee = rows.reduce((s, r) => s + r.fee, 0);
  const totalNet = rows.reduce((s, r) => s + r.net, 0);

  return {
    accountRatio,
    toonRatio,
    feeRate,
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
    const amount = Math.max(0, Number(d.amount || 0));
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
      const b = byMember.get(id);
      if (!b) continue;
      b.count += incCount;
      b.amount += incAmount;
    }
  }

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
    .sort((a, b) => b.score - a.score);
}

