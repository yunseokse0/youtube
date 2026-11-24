"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildMemberRankSnapshot,
  buildRankChangeSessionSnapshot,
  detectRankImprovementForFx,
  type RankImprovementEvent,
} from "@/lib/excel-member-rank-change";
import type { OverlayRankRow } from "@/lib/excel-member-rank-change";
import type { MemberRankingMetric } from "@/lib/utils";
import type { Donor, Member } from "@/types";

/** 엑셀표·순위변동 전용 — 멤버 순위 상승 1건 감지(후원 삭제 셔플 제외) */
export function useMemberRankChangeFx(opts: {
  enabled: boolean;
  ready: boolean;
  ranked: OverlayRankRow[];
  members: Member[];
  donors: Donor[] | unknown;
  rankingMetric?: MemberRankingMetric;
}): {
  event: RankImprovementEvent | null;
  clearEvent: () => void;
} {
  const { enabled, ready, ranked, members, donors, rankingMetric = "contribution" } = opts;
  const [event, setEvent] = useState<RankImprovementEvent | null>(null);
  const prevRankSnapshotRef = useRef<ReturnType<typeof buildMemberRankSnapshot> | null>(null);
  const prevSessionRef = useRef<ReturnType<typeof buildRankChangeSessionSnapshot> | null>(null);
  const cooldownRef = useRef(0);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !ready) return;
    const rankSnapshot = buildMemberRankSnapshot(ranked);
    const session = buildRankChangeSessionSnapshot(members, donors, rankingMetric);
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
    if (now - cooldownRef.current < 5200) return;
    cooldownRef.current = now;
    setEvent(hit);
  }, [enabled, ready, ranked, members, donors, rankingMetric]);

  const clearEvent = useCallback(() => setEvent(null), []);

  return { event, clearEvent };
}

export type MultiPresetRankTarget = {
  id: string;
  name?: string;
  ranked: OverlayRankRow[];
  members: Member[];
  donors: Donor[] | unknown;
  rankingMetric?: MemberRankingMetric;
};

/** 복수 엑셀표 프리셋 감지용 — 여러 엑셀표 중 어느 하나라도 순위 상승 시 동일 테마 연출 1건 감지 */
export function useMultiPresetMemberRankChangeFx(opts: {
  enabled: boolean;
  ready: boolean;
  targets: MultiPresetRankTarget[];
}): {
  event: RankImprovementEvent | null;
  clearEvent: () => void;
} {
  const { enabled, ready, targets } = opts;
  const [event, setEvent] = useState<RankImprovementEvent | null>(null);
  const prevSnapshotsRef = useRef<
    Map<
      string,
      {
        rankSnapshot: ReturnType<typeof buildMemberRankSnapshot>;
        session: ReturnType<typeof buildRankChangeSessionSnapshot>;
      }
    >
  >(new Map());
  const cooldownRef = useRef(0);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !ready || targets.length === 0) return;
    const now = Date.now();
    let detectedHit: RankImprovementEvent | null = null;

    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      const initialMap = new Map();
      for (const t of targets) {
        const rankSnapshot = buildMemberRankSnapshot(t.ranked);
        const session = buildRankChangeSessionSnapshot(t.members, t.donors, t.rankingMetric || "contribution");
        initialMap.set(t.id, { rankSnapshot, session });
      }
      prevSnapshotsRef.current = initialMap;
      return;
    }

    const nextMap = new Map(prevSnapshotsRef.current);
    for (const t of targets) {
      const rankSnapshot = buildMemberRankSnapshot(t.ranked);
      const session = buildRankChangeSessionSnapshot(t.members, t.donors, t.rankingMetric || "contribution");
      const prev = prevSnapshotsRef.current.get(t.id);

      if (prev) {
        const membersById = new Map(t.members.map((m) => [m.id, m]));
        const hit = detectRankImprovementForFx(
          prev.rankSnapshot,
          rankSnapshot,
          membersById,
          prev.session ?? session,
          session
        );
        if (hit && !detectedHit && now - cooldownRef.current >= 5200) {
          detectedHit = hit;
        }
      }
      nextMap.set(t.id, { rankSnapshot, session });
    }

    prevSnapshotsRef.current = nextMap;

    if (detectedHit) {
      cooldownRef.current = now;
      setEvent(detectedHit);
    }
  }, [enabled, ready, targets]);

  const clearEvent = useCallback(() => setEvent(null), []);

  return { event, clearEvent };
}
