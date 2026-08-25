/** OBS 후원 출력 오버레이 — 계좌·투네 공통 */

export type DonationAlertTarget = "account" | "toon";

export type DonationAlertShowItem = {
  id: string;
  donorName: string;
  memberName: string;
  amount: number;
  target: DonationAlertTarget;
  /** 기여도 점수 — 후원 금액과 동일(원=점, 예: 4,000 → 4,000) */
  contributionPoints: number;
  at: number;
};

export const DONATION_ALERT_DISPLAY_MS = 7000;
export const DONATION_ALERT_POLL_MS = 2000;

/** 기여도 점수: 후원 금액과 1:1 (4,000원 → 4,000점) */
export function donationContributionPoints(amount: number): number {
  return Math.max(0, Math.round(Number(amount) || 0));
}

export function donationAlertTargetLabel(target: DonationAlertTarget): string {
  return target === "account" ? "계좌 후원" : "투네이션 후원";
}

export function normalizeDonationAlertTarget(raw: unknown): DonationAlertTarget {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "account" || s === "계좌") return "account";
  return "toon";
}

export function buildDonationAlertUrl(userId: string, opts?: { test?: boolean }): string {
  const uid = String(userId || "").trim();
  const q = new URLSearchParams();
  if (uid) q.set("u", uid);
  q.set("host", "obs");
  /** 후원 알림은 실시간성이 중요 — OBS에서도 SSE 허용 */
  q.set("overlayAllowSse", "1");
  if (opts?.test) q.set("test", "true");
  return `/overlay/donation-alert?${q.toString()}`;
}

export function donationAlertFromAppliedHint(
  hint: {
    donorName?: string;
    amount?: number;
    target?: string;
    memberName?: string;
  },
  idSeed?: string
): DonationAlertShowItem | null {
  const amount = Math.max(0, Math.round(Number(hint.amount) || 0));
  if (amount <= 0) return null;
  const donorName = String(hint.donorName || "무명").replace(/\s+/g, "") || "무명";
  const memberName = String(hint.memberName || "").trim() || "—";
  const target = normalizeDonationAlertTarget(hint.target);
  const at = Date.now();
  return {
    id: String(idSeed || "").trim() || `alert_${at}_${amount}`,
    donorName,
    memberName,
    amount,
    target,
    contributionPoints: donationContributionPoints(amount),
    at,
  };
}

/** 단일 donor 레코드 → 알림 (금액 없으면 null) */
export function donationAlertFromDonorRecord(
  donor: Record<string, unknown>,
  members: Array<{ id?: string; name?: string }>
): DonationAlertShowItem | null {
  const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
  if (amount <= 0) return null;
  const atRaw = Number(donor.at);
  const at = Number.isFinite(atRaw) && atRaw > 0 ? atRaw : Date.now();
  const memberId = String(donor.memberId || "").trim();
  const memberName =
    members.find((m) => String(m.id || "").trim() === memberId)?.name?.trim() || "—";
  const target = normalizeDonationAlertTarget(donor.target ?? donor.type);
  const id = String(donor.id || "").trim() || `d_${at}_${amount}`;
  return {
    id,
    donorName: String(donor.name || "무명").replace(/\s+/g, "") || "무명",
    memberName,
    amount,
    target,
    contributionPoints: donationContributionPoints(amount),
    at,
  };
}

/** 서버 donors 스냅샷에서 최신 1건 → 알림 후보 */
export function donationAlertFromLatestDonor(
  donors: Array<Record<string, unknown>>,
  members: Array<{ id?: string; name?: string }>
): DonationAlertShowItem | null {
  if (!Array.isArray(donors) || donors.length === 0) return null;
  let best: Record<string, unknown> | null = null;
  let bestAt = -1;
  for (const d of donors) {
    const at = Number(d.at);
    const t = Number.isFinite(at) ? at : 0;
    if (t >= bestAt) {
      bestAt = t;
      best = d;
    }
  }
  if (!best) return null;
  return donationAlertFromDonorRecord(best, members);
}

/** 아직 보지 않은 후원을 at 오름차순으로 (폴링 신규 감지) */
export function donationAlertsFromUnseenDonors(
  donors: Array<Record<string, unknown>>,
  members: Array<{ id?: string; name?: string }>,
  seenIds: ReadonlySet<string>
): DonationAlertShowItem[] {
  if (!Array.isArray(donors) || donors.length === 0) return [];
  const out: DonationAlertShowItem[] = [];
  for (const d of donors) {
    const id = String(d.id || "").trim();
    if (!id || seenIds.has(id)) continue;
    const item = donationAlertFromDonorRecord(d, members);
    if (item) out.push(item);
  }
  out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return out;
}

export const DONATION_ALERT_TEST_ITEM: DonationAlertShowItem = {
  id: "test-donation-alert",
  donorName: "푸바오",
  memberName: "MC거루",
  amount: 40_000,
  target: "toon",
  contributionPoints: 40_000,
  at: Date.now(),
};
