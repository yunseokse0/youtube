import type { Member } from "@/types";
import { normalizeDonorsArray } from "@/lib/state";
import { memberDonationRankingTotal } from "@/lib/utils";

export type OverlayRankRow = { m: Member; rank: number | null };

export type MemberRankSnapshot = Map<string, number | null>;

export type RankChangeSessionSnapshot = {
  donorCount: number;
  totalCombined: number;
  memberTotals: Map<string, number>;
};

export type RankImprovementEvent = {
  memberId: string;
  memberName: string;
  oldRank: number;
  newRank: number;
  /** 양수 — 몇 계단 상승했는지 */
  delta: number;
};

export function buildMemberRankSnapshot(ranked: OverlayRankRow[]): MemberRankSnapshot {
  const map: MemberRankSnapshot = new Map();
  for (const row of ranked) {
    if (!row?.m?.id) continue;
    map.set(row.m.id, row.rank ?? null);
  }
  return map;
}

/**
 * 엑셀표 멤버 순위 상승(숫자 감소) 1건 — 동시 다발이면 가장 많이 오른 멤버.
 * 첫 스냅샷·대표(rank null)·하락/동률은 무시.
 */
export function detectRankImprovement(
  prev: MemberRankSnapshot | null | undefined,
  next: MemberRankSnapshot,
  membersById: ReadonlyMap<string, Member> | Map<string, Member>
): RankImprovementEvent | null {
  if (!prev || prev.size === 0) return null;

  let best: RankImprovementEvent | null = null;
  for (const [memberId, newRank] of next) {
    if (newRank == null || newRank <= 0) continue;
    const oldRank = prev.get(memberId);
    if (oldRank == null || oldRank <= 0 || newRank >= oldRank) continue;

    const delta = oldRank - newRank;
    const memberName = membersById.get(memberId)?.name?.trim() || "멤버";
    const candidate: RankImprovementEvent = {
      memberId,
      memberName,
      oldRank,
      newRank,
      delta,
    };
    if (
      !best ||
      candidate.delta > best.delta ||
      (candidate.delta === best.delta && candidate.newRank < best.newRank)
    ) {
      best = candidate;
    }
  }
  return best;
}

export function buildRankChangeSessionSnapshot(members: Member[], donors: unknown): RankChangeSessionSnapshot {
  const memberTotals = new Map<string, number>();
  let totalCombined = 0;
  for (const m of members) {
    if (!m?.id) continue;
    const t = memberDonationRankingTotal(m);
    memberTotals.set(m.id, t);
    totalCombined += t;
  }
  return {
    donorCount: normalizeDonorsArray(donors).length,
    totalCombined,
    memberTotals,
  };
}

/** 후원 삭제·합계 감소·본인 금액 미증가로 인한 순위 상승 */
export function isRankImprovementFromDonationDeletion(
  prev: RankChangeSessionSnapshot,
  next: RankChangeSessionSnapshot,
  hit: RankImprovementEvent
): boolean {
  if (next.donorCount < prev.donorCount) return true;
  if (next.totalCombined < prev.totalCombined) return true;
  const prevMember = prev.memberTotals.get(hit.memberId) ?? 0;
  const nextMember = next.memberTotals.get(hit.memberId) ?? 0;
  return nextMember <= prevMember;
}

/** 연출용 — detectRankImprovement + 후원 삭제 셔플 제외 */
export function detectRankImprovementForFx(
  prevRank: MemberRankSnapshot | null | undefined,
  nextRank: MemberRankSnapshot,
  membersById: ReadonlyMap<string, Member> | Map<string, Member>,
  prevSession: RankChangeSessionSnapshot,
  nextSession: RankChangeSessionSnapshot
): RankImprovementEvent | null {
  const hit = detectRankImprovement(prevRank, nextRank, membersById);
  if (!hit) return null;
  if (isRankImprovementFromDonationDeletion(prevSession, nextSession, hit)) return null;
  return hit;
}

export function isMemberRankChangeFxEnabled(raw: unknown): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!v) return true;
  return !(v === "off" || v === "0" || v === "false" || v === "no");
}
