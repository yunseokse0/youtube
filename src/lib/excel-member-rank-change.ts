import type { Member } from "@/types";

export type OverlayRankRow = { m: Member; rank: number | null };

export type MemberRankSnapshot = Map<string, number | null>;

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

export function isMemberRankChangeFxEnabled(raw: unknown): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!v) return true;
  return !(v === "off" || v === "0" || v === "false" || v === "no");
}
