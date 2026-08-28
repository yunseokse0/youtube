"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildMemberRankSnapshot,
  detectRankImprovement,
  type RankImprovementEvent,
} from "@/lib/excel-member-rank-change";
import type { OverlayRankRow } from "@/lib/excel-member-rank-change";
import type { Member } from "@/types";

/** 엑셀표·순위변동 전용 — 멤버 순위 상승 1건 감지 */
export function useMemberRankChangeFx(opts: {
  enabled: boolean;
  ready: boolean;
  ranked: OverlayRankRow[];
  members: Member[];
}): {
  event: RankImprovementEvent | null;
  clearEvent: () => void;
} {
  const { enabled, ready, ranked, members } = opts;
  const [event, setEvent] = useState<RankImprovementEvent | null>(null);
  const prevSnapshotRef = useRef<ReturnType<typeof buildMemberRankSnapshot> | null>(null);
  const cooldownRef = useRef(0);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !ready) return;
    const snapshot = buildMemberRankSnapshot(ranked);
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      prevSnapshotRef.current = snapshot;
      return;
    }
    const membersById = new Map(members.map((m) => [m.id, m]));
    const hit = detectRankImprovement(prevSnapshotRef.current, snapshot, membersById);
    prevSnapshotRef.current = snapshot;
    if (!hit) return;
    const now = Date.now();
    if (now - cooldownRef.current < 2500) return;
    cooldownRef.current = now;
    setEvent(hit);
  }, [enabled, ready, ranked, members]);

  const clearEvent = useCallback(() => setEvent(null), []);

  return { event, clearEvent };
}
