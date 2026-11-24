"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExcelMemberRankChangeOverlay } from "@/components/overlay/ExcelMemberRankChangeOverlay";
import {
  useMemberRankChangeFx,
  useMultiPresetMemberRankChangeFx,
  type MultiPresetRankTarget,
} from "@/hooks/useMemberRankChangeFx";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { subscribeOverlayPresetsLocalUpdated } from "@/lib/broadcast-state-local-sync";
import { isMemberRankChangeFxEnabled } from "@/lib/excel-member-rank-change";
import { resolveExcelMemberRankChangeStyle } from "@/lib/excel-member-rank-change-style";
import { applyOverlayDonationDisplayTotals } from "@/lib/overlay-donation-aggregate";
import {
  getOverlayUserIdFromSearchParams,
  mergeOverlayPresetsForOverlayView,
  resolveDonationAggregateFromAt,
  resolveDay777Calc,
  resolvePongdangManualMode,
  type OverlayPresetLike,
} from "@/lib/overlay-params";
import { overlayPresetsStorageKey, normalizeDonorsArray } from "@/lib/state";
import {
  buildOverlayRankedMembers,
  normalizeMemberRankingMetric,
  type MemberRankingMetric,
} from "@/lib/utils";
import type { AppState, Member } from "@/types";

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
    if (pid && pid !== "all") {
      const firstId = pid.split(",")[0]?.trim();
      const hit = overlayPresets.find((p) => p.id === firstId || p.id === pid);
      if (hit) return hit;
    }
    return overlayPresets.find((p) => p.showMembers !== false) ?? overlayPresets[0] ?? null;
  }, [overlayPresets, sp]);

  const targetPresets = useMemo<OverlayPresetLike[]>(() => {
    const pParam = (sp.get("p") || sp.get("preset") || "").trim();
    if (!pParam || pParam === "all") {
      const list = overlayPresets.filter((p) => p.showMembers !== false);
      return list.length > 0 ? list : overlayPresets.slice(0, 1);
    }
    const ids = pParam.split(",").map((s) => s.trim()).filter(Boolean);
    const found = overlayPresets.filter((p) => ids.includes(p.id || ""));
    return found.length > 0 ? found : [activePreset].filter(Boolean);
  }, [sp, overlayPresets, activePreset]);

  const memberRankChangeStyle = useMemo(
    () => resolveExcelMemberRankChangeStyle(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );

  const fxEnabled = useMemo(() => {
    const raw = sp.get("memberRankChangeFx");
    if (raw) return isMemberRankChangeFxEnabled(raw);
    return targetPresets.some((p) => isMemberRankChangeFxEnabled(p.memberRankChangeFx));
  }, [sp, targetPresets]);

  const members = useMemo(
    () => (ready && state?.members?.length ? state.members : []) as Member[],
    [ready, state?.members]
  );

  const donorsForRankFx = useMemo(
    () => normalizeDonorsArray(state?.donors),
    [state?.donors]
  );

  const memberPositionsMap = useMemo(
    () => (ready && state?.memberPositions ? state.memberPositions : {}) as Record<string, string>,
    [ready, state?.memberPositions]
  );

  const memberRankingMetric = useMemo<MemberRankingMetric>(() => {
    const q = sp.get("rankingMetric") || sp.get("memberRankingMetric");
    if (q) return normalizeMemberRankingMetric(q);
    return ready && state ? normalizeMemberRankingMetric(state.memberRankingMetric) : "contribution";
  }, [ready, state, sp]);

  const getMemberRole = useCallback(
    (m: Member) => String(memberPositionsMap[m.id] || "").trim(),
    [memberPositionsMap]
  );

  const pinnedFilter = useCallback(
    (m: Member) => Boolean(m.operating) || /운영비/i.test(m.name) || /운영비/i.test(getMemberRole(m)),
    [getMemberRole]
  );

  const rankTargets = useMemo<MultiPresetRankTarget[]>(() => {
    if (!ready || !state) return [];
    return targetPresets.map((tp) => {
      const tpDay777 = resolveDay777Calc(sp, tp, { ready });
      const tpPongdangManual = resolvePongdangManualMode(sp, tp, { ready }, state as AppState);
      const tpFromAt = resolveDonationAggregateFromAt(sp, tp, { ready });
      const tpExcludedSet = new Set(
        (Array.isArray(tp.excludedMemberIds)
          ? tp.excludedMemberIds
          : typeof tp.excludedMemberIds === "string"
          ? String(tp.excludedMemberIds).split(",").map((s) => s.trim())
          : []
        ).concat(tpDay777 ? (state?.pongdangExcludedMemberIds || []) : [])
      );
      const tpSynced = applyOverlayDonationDisplayTotals(
        state as AppState,
        {
          fromAt: tpFromAt,
          day777Calc: tpDay777,
          pongdangManualMode: tpPongdangManual,
          // 퐁당퐁당 엑셀표에서는 마이너스 기여도를 0으로 클램핑하지 않고 음수 그대로 표시
          isPongdangPopup:
            tpDay777 ||
            tp.theme === "excelPongdang" ||
            tp.membersTheme === "excelPongdang" ||
            String(tp.name || "").includes("퐁당"),
        }
      );
      const tpMembers = (tpSynced.members || (members as Member[])).filter((m) => !tpExcludedSet.has(m.id));
      const tpUnpinned = tpMembers.filter((m) => !pinnedFilter(m));
      const tpMetric = normalizeMemberRankingMetric(tp.rankingMetric || tp.memberRankingMetric || memberRankingMetric);
      const tpRanked = buildOverlayRankedMembers(
        tpUnpinned,
        memberPositionsMap,
        getMemberRole,
        tpMembers,
        undefined,
        tpMetric,
        {
          fixedPositionMemberIds: (state as AppState | null)?.fixedPositionMemberIds,
          memberPositionMode: (state as AppState | null)?.memberPositionMode,
        }
      );
      return {
        id: tp.id || "default",
        name: tp.name,
        ranked: tpRanked,
        members: tpMembers,
        donors: donorsForRankFx,
        rankingMetric: tpMetric,
      };
    });
  }, [
    ready,
    state,
    targetPresets,
    sp,
    members,
    pinnedFilter,
    memberPositionsMap,
    getMemberRole,
    memberRankingMetric,
    donorsForRankFx,
  ]);

  const { event, clearEvent } = useMultiPresetMemberRankChangeFx({
    enabled: fxEnabled,
    ready,
    targets: rankTargets,
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
