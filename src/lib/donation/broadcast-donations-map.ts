import type { Donor, DonorTarget } from "@/types";

export type BroadcastDonationRow = {
  user_id: string;
  id: string;
  name: string;
  amount: number;
  member_id: string;
  at_ms: number;
  target: string | null;
  message: string | null;
  member_auto_assigned: 0 | 1;
  group_split: 0 | 1;
  group_split_source: 0 | 1;
  donation_excluded: 0 | 1;
  hs_territory_excluded: 0 | 1;
  hs_push_dir: string | null;
  contribution_points: number | null;
  updated_at_ms: number;
};

function bool01(v: unknown): 0 | 1 {
  return v === true || v === 1 || v === "1" ? 1 : 0;
}

function normalizeTarget(v: unknown): string | null {
  const s = String(v || "").trim();
  if (s === "account" || s === "toon") return s;
  return null;
}

function normalizePushDir(v: unknown): string | null {
  const s = String(v || "").trim();
  if (s === "left" || s === "right" || s === "split") return s;
  return null;
}

export function donorToBroadcastRow(
  userId: string,
  donor: Donor,
  updatedAtMs = Date.now()
): BroadcastDonationRow {
  const points = Number(donor.contributionPoints);
  return {
    user_id: String(userId || "").slice(0, 64),
    id: String(donor.id || "").slice(0, 128),
    name: String(donor.name || "").slice(0, 191) || "익명",
    amount: Math.max(0, Math.floor(Number(donor.amount) || 0)),
    member_id: String(donor.memberId || "").slice(0, 128),
    at_ms: Math.max(0, Math.floor(Number(donor.at) || 0)),
    target: normalizeTarget(donor.target),
    message: donor.message != null ? String(donor.message) : null,
    member_auto_assigned: bool01(donor.memberAutoAssigned),
    group_split: bool01(donor.groupSplit),
    group_split_source: bool01(donor.groupSplitSource),
    donation_excluded: bool01(donor.donationExcluded),
    hs_territory_excluded: bool01(donor.hsTerritoryExcluded),
    hs_push_dir: normalizePushDir(donor.hsPushDir),
    contribution_points: Number.isFinite(points) ? Math.round(points) : null,
    updated_at_ms: Math.max(0, Math.floor(Number(updatedAtMs) || Date.now())),
  };
}

export function broadcastRowToDonor(row: BroadcastDonationRow): Donor {
  const donor: Donor = {
    id: String(row.id || ""),
    name: String(row.name || ""),
    amount: Math.max(0, Math.floor(Number(row.amount) || 0)),
    memberId: String(row.member_id || ""),
    at: Math.max(0, Math.floor(Number(row.at_ms) || 0)),
  };
  const target = normalizeTarget(row.target);
  if (target) donor.target = target as DonorTarget;
  if (row.message != null && String(row.message).length > 0) donor.message = String(row.message);
  if (row.member_auto_assigned) donor.memberAutoAssigned = true;
  if (row.group_split) donor.groupSplit = true;
  if (row.group_split_source) donor.groupSplitSource = true;
  if (row.donation_excluded) donor.donationExcluded = true;
  if (row.hs_territory_excluded) donor.hsTerritoryExcluded = true;
  const push = normalizePushDir(row.hs_push_dir);
  if (push) donor.hsPushDir = push as Donor["hsPushDir"];
  if (row.contribution_points != null && Number.isFinite(Number(row.contribution_points))) {
    donor.contributionPoints = Math.round(Number(row.contribution_points));
  }
  return donor;
}

export function donorsToBroadcastRows(
  userId: string,
  donors: Donor[],
  updatedAtMs = Date.now()
): BroadcastDonationRow[] {
  const out: BroadcastDonationRow[] = [];
  const seen = new Set<string>();
  for (const d of donors) {
    const id = String(d?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(donorToBroadcastRow(userId, d, updatedAtMs));
  }
  return out;
}
