"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExcelMemberRankChangeOverlay } from "@/components/overlay/ExcelMemberRankChangeOverlay";
import { useMemberRankChangeFx } from "@/hooks/useMemberRankChangeFx";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { subscribeOverlayPresetsLocalUpdated } from "@/lib/broadcast-state-local-sync";
import { isMemberRankChangeFxEnabled } from "@/lib/excel-member-rank-change";
import { resolveExcelMemberRankChangeStyle } from "@/lib/excel-member-rank-change-style";
import {
  getOverlayUserIdFromSearchParams,
  mergeOverlayPresetsForOverlayView,
  type OverlayPresetLike,
} from "@/lib/overlay-params";
import { overlayPresetsStorageKey } from "@/lib/state";
import { buildOverlayRankedMembers } from "@/lib/utils";
import type { Member } from "@/types";

function RankChangeOverlayInner() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const { state, ready } = useOverlayRemoteState(userId, { storageDebounceMs: 0 });

  const [localPresets, setLocalPresets] = useState<OverlayPresetLike[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const perUserKey = overlayPresetsStorageKey(userId);
      const raw =
        window.localStorage.getItem(perUserKey) ||
        window.localStorage.getItem("excel-broadcast-overlay-presets");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OverlayPresetLike[]) : [];
    } catch {
      return [];
    }
  });

  const readLocalPresets = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const perUserKey = overlayPresetsStorageKey(userId);
      const raw =
        window.localStorage.getItem(perUserKey) ||
        window.localStorage.getItem("excel-broadcast-overlay-presets");
      if (!raw) {
        setLocalPresets([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setLocalPresets(parsed as OverlayPresetLike[]);
    } catch {
      setLocalPresets([]);
    }
  }, [userId]);

  useEffect(() => {
    readLocalPresets();
    const perUserKey = overlayPresetsStorageKey(userId);
    const onStorage = (e: StorageEvent) => {
      if (e.key === perUserKey || e.key === "excel-broadcast-overlay-presets") readLocalPresets();
    };
    window.addEventListener("storage", onStorage);
    const unsubscribe = subscribeOverlayPresetsLocalUpdated(() => readLocalPresets());
    return () => {
      window.removeEventListener("storage", onStorage);
      unsubscribe();
    };
  }, [readLocalPresets, userId]);

  const overlayPresets = useMemo(() => {
    const remote =
      ready && state && Array.isArray(state.overlayPresets)
        ? (state.overlayPresets as OverlayPresetLike[])
        : [];
    return mergeOverlayPresetsForOverlayView(remote, localPresets, sp);
  }, [ready, state, localPresets, sp]);

  const activePreset = useMemo(() => {
    const pid = sp.get("p") || sp.get("preset");
    if (pid) {
      const hit = overlayPresets.find((p) => p.id === pid);
      if (hit) return hit;
    }
    return overlayPresets.find((p) => p.showMembers !== false) ?? overlayPresets[0] ?? null;
  }, [overlayPresets, sp]);

  const memberRankChangeStyle = useMemo(
    () => resolveExcelMemberRankChangeStyle(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );

  const fxEnabled = useMemo(() => {
    const raw =
      sp.get("memberRankChangeFx") ||
      (activePreset as OverlayPresetLike | null)?.memberRankChangeFx ||
      "";
    return isMemberRankChangeFxEnabled(raw);
  }, [sp, activePreset]);

  const members = useMemo(
    () => (ready && state?.members?.length ? state.members : []) as Member[],
    [ready, state?.members]
  );

  const memberPositionsMap = useMemo(
    () => (ready && state?.memberPositions ? state.memberPositions : {}) as Record<string, string>,
    [ready, state?.memberPositions]
  );

  const getMemberRole = useCallback(
    (m: Member) => String(memberPositionsMap[m.id] || "").trim(),
    [memberPositionsMap]
  );

  const pinnedFilter = useCallback(
    (m: Member) => Boolean(m.operating) || /운영비/i.test(m.name) || /운영비/i.test(getMemberRole(m)),
    [getMemberRole]
  );

  const unpinned = useMemo(() => members.filter((m) => !pinnedFilter(m)), [members, pinnedFilter]);

  const ranked = useMemo(
    () => buildOverlayRankedMembers(unpinned, memberPositionsMap, getMemberRole, members),
    [unpinned, memberPositionsMap, getMemberRole, members]
  );

  const { event, clearEvent } = useMemberRankChangeFx({
    enabled: fxEnabled,
    ready,
    ranked,
    members,
  });

  return (
    <div className="min-h-screen bg-transparent">
      {fxEnabled ? (
        <ExcelMemberRankChangeOverlay event={event} onDone={clearEvent} style={memberRankChangeStyle} />
      ) : null}
    </div>
  );
}

export default function RankChangeOverlayPage() {
  return (
    <Suspense fallback={null}>
      <RankChangeOverlayInner />
    </Suspense>
  );
}
