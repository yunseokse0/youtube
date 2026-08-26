import type {
  DonationAlertLabels,
  DonationAlertShowItem,
  DonationAlertTarget,
  DonationAlertUrlOptions,
  DonationAppliedHint,
  DonationMemberRef,
  DonationRecordRef,
} from "./types";
import { DEFAULT_DONATION_ALERT_LABELS } from "./types";

export const DONATION_ALERT_DISPLAY_MS = 7000;
export const DONATION_ALERT_POLL_MS = 2000;

export const DONATION_ALERT_TEST_ITEM: DonationAlertShowItem = {
  id: "test-donation-alert",
  donorName: "푸바오",
  memberName: "MC거루",
  amount: 40_000,
  target: "toon",
  contributionPoints: 40_000,
  at: Date.now(),
};

/** 기여도 점수: 후원 금액과 1:1 (4,000원 → 4,000점) */
export function donationContributionPoints(amount: number): number {
  return Math.max(0, Math.round(Number(amount) || 0));
}

export function normalizeDonationAlertTarget(raw: unknown): DonationAlertTarget {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "account" || s === "계좌") return "account";
  return "toon";
}

export function donationAlertTargetLabel(
  target: DonationAlertTarget,
  labels: DonationAlertLabels = DEFAULT_DONATION_ALERT_LABELS
): string {
  return target === "account" ? labels.accountTarget : labels.toonTarget;
}

export function buildDonationAlertUrl(
  userId: string,
  opts?: DonationAlertUrlOptions
): string {
  const uid = String(userId || "").trim();
  const basePath = opts?.basePath ?? "/overlay/donation-alert";
  const q = new URLSearchParams();
  if (uid) q.set("u", uid);
  if (opts?.host !== false) q.set("host", opts?.host ?? "obs");
  if (opts?.allowSse !== false) q.set("overlayAllowSse", "1");
  if (opts?.test) q.set("test", "true");
  if (opts?.extraParams) {
    for (const [k, v] of Object.entries(opts.extraParams)) {
      if (v) q.set(k, v);
    }
  }
  const qs = q.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function donationAlertFromAppliedHint(
  hint: DonationAppliedHint,
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

export function donationAlertFromDonorRecord(
  donor: DonationRecordRef,
  members: DonationMemberRef[]
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

export function donationAlertFromLatestDonor(
  donors: DonationRecordRef[],
  members: DonationMemberRef[]
): DonationAlertShowItem | null {
  if (!Array.isArray(donors) || donors.length === 0) return null;
  let best: DonationRecordRef | null = null;
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
  donors: DonationRecordRef[],
  members: DonationMemberRef[],
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

/** donor id 목록을 seen 집합에 시드 (첫 폴링 시 기존 후원 무시) */
export function seedSeenDonorIds(
  donors: DonationRecordRef[],
  seenIds: Set<string>
): void {
  for (const d of donors) {
    const id = String(d.id || "").trim();
    if (id) seenIds.add(id);
  }
}
