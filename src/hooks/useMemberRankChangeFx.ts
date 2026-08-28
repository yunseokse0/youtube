"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildMemberRankSnapshot,
  buildRankChangeSessionSnapshot,
  detectRankImprovementForFx,
  type RankImprovementEvent,
} from "@/lib/excel-member-rank-change";
import type { OverlayRankRow } from "@/lib/excel-member-rank-change";
import type { Donor, Member } from "@/types";

/** 엑셀표·순위변동 전용 — 멤버 순위 상승 1건 감지(후원 삭제 셔플 제외) */
export function useMemberRankChangeFx(opts: {
  enabled: boolean;
  ready: boolean;
  ranked: OverlayRankRow[];
  members: Member[];
  donors: Donor[] | unknown;
}): {
  event: RankImprovementEvent | null;
  clearEvent: () => void;
} {
  const { enabled, ready, ranked, members, donors } = opts;
  const [event, setEvent] = useState<RankImprovementEvent | null>(null);
  const prevRankSnapshotRef = useRef<ReturnType<typeof buildMemberRankSnapshot> | null>(null);
  const prevSessionRef = useRef<ReturnType<typeof buildRankChangeSessionSnapshot> | null>(null);
  const cooldownRef = useRef(0);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !ready) return;
    const rankSnapshot = buildMemberRankSnapshot(ranked);
    const session = buildRankChangeSessionSnapshot(members, donors);
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      prevRankSnapshotRef.current = rankSnapshot;
      prevSessionRef.current = session;
      return;
    }
    const membersById = new Map(members.map((m) => [m.id, m]));
    const hit = detectRankImprovementForFx(
      prevRankSnapshotRef.current,
      rankSnapshot,
      membersById,
      prevSessionRef.current ?? session,
      session
    );
    prevRankSnapshotRef.current = rankSnapshot;
    prevSessionRef.current = session;
    if (!hit) return;
    const now = Date.now();
    if (now - cooldownRef.current < 2500) return;
    cooldownRef.current = now;
    setEvent(hit);
  }, [enabled, ready, ranked, members, donors]);

  const clearEvent = useCallback(() => setEvent(null), []);

  return { event, clearEvent };
}
